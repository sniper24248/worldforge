#!/usr/bin/env node
/**
 * WorldForge 后端 — 零依赖 Node HTTP 服务
 *
 * 职责：
 *   1. 托管 public/ 静态前端
 *   2. /api/world 整份世界观数据的读取与原子写回
 *   3. /api/images/* 生图代理（ComfyUI 本地 / 智谱云端）
 *   4. /api/ai 文本辅助代理（OpenAI 兼容接口，用户自填 key）
 *
 * 启动：node server.mjs [--port 7317] [--host 127.0.0.1]
 */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const WORLDS_DIR = path.join(DATA_DIR, 'worlds');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const WORLD_FILE = path.join(DATA_DIR, 'world.json'); // 老版本的单世界文件，仅用于迁移
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PORT = Number(argOf('port', process.env.WORLDFORGE_PORT || 7317));
const HOST = argOf('host', '127.0.0.1');
const STARTED_AT = new Date().toISOString();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const DEFAULT_CONFIG = {
  image: {
    provider: 'comfyui', // comfyui | zhipu
    comfyui: {
      baseURL: 'http://127.0.0.1:8188',
      checkpoint: 'sd_xl_base_1.0.safetensors',
      steps: 28,
      cfg: 6.5,
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      timeoutMs: 300000
    },
    zhipu: {
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-image',
      apiKey: ''
    }
  },
  ai: {
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKey: ''
  }
};

/* ---------- 多世界观：目录、当前世界、迁移 ---------- */

const worldPath = (id) => path.join(WORLDS_DIR, `${id}.json`);
const worldId = () => `w-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;

function emptyWorld(title = '未命名世界') {
  return {
    meta: { title, genre: '', logline: '', worldStyle: '', tone: '', updatedAt: '' },
    entities: [],
    relations: [],
    events: [],
    gallery: [],
    map: { canvas: { w: 1600, h: 1000 }, bg: null, bgOpacity: 0.45, regions: [], pins: [], routes: [] }
  };
}

async function listWorldIds() {
  const files = await fs.readdir(WORLDS_DIR).catch(() => []);
  return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
}

async function listWorlds() {
  const out = [];
  for (const id of await listWorldIds()) {
    try {
      const w = JSON.parse(await fs.readFile(worldPath(id), 'utf8'));
      out.push({
        id,
        title: w?.meta?.title || '未命名世界',
        genre: w?.meta?.genre || '',
        updatedAt: w?.meta?.updatedAt || null,
        counts: {
          entities: (w.entities || []).length,
          relations: (w.relations || []).length,
          events: (w.events || []).length,
          images: (w.gallery || []).length
        }
      });
    } catch {
      /* 坏文件跳过 */
    }
  }
  out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return out;
}

async function readState() {
  const st = await readJsonFile(STATE_FILE, { active: null });
  return st && typeof st === 'object' ? st : { active: null };
}

/** 把老的单文件世界搬进 worlds/，保留一份 .migrated 备份 */
async function migrateLegacyWorld() {
  const ids = await listWorldIds();
  if (ids.length) return;
  let legacy = null;
  try {
    legacy = JSON.parse(await fs.readFile(WORLD_FILE, 'utf8'));
  } catch {
    legacy = null;
  }
  const id = worldId();
  await writeJsonAtomic(worldPath(id), legacy || emptyWorld());
  await writeJsonAtomic(STATE_FILE, { active: id });
  if (legacy) await fs.rename(WORLD_FILE, `${WORLD_FILE}.migrated`).catch(() => {});
  console.log(`[worldforge] 已迁移到多世界目录：${id}`);
}

async function ensureActiveWorld() {
  const ids = await listWorldIds();
  const st = await readState();
  if (st.active && ids.includes(st.active)) return st.active;
  let active = ids[0] || null;
  if (!active) {
    active = worldId();
    await writeJsonAtomic(worldPath(active), emptyWorld());
  }
  await writeJsonAtomic(STATE_FILE, { active });
  return active;
}

/* ---------- 小工具 ---------- */

function sendJSON(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store'
  });
  res.end(body);
}

function fail(res, status, message, detail) {
  sendJSON(res, status, { ok: false, error: message, detail: detail ?? null });
}

async function readBody(req, limit = 16 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error(`请求体超过 ${limit} 字节上限`);
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return structuredClone(fallback);
    throw err;
  }
}

/** 原子写：先写临时文件再 rename，避免半截 JSON */
async function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

async function ensureDirs() {
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await fs.mkdir(WORLDS_DIR, { recursive: true });
  await migrateLegacyWorld();
  await ensureActiveWorld();
  try {
    await fs.access(CONFIG_FILE);
  } catch {
    await writeJsonAtomic(CONFIG_FILE, DEFAULT_CONFIG);
  }
}

/** 配置深合并，缺的键用默认值补齐（不改用户已填的） */
function mergeConfig(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = mergeConfig(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** 返回给前端的配置：密钥只报“有没有”，不回显明文 */
function publicConfig(cfg) {
  const clone = structuredClone(cfg);
  const secret = (s) => (s ? `••••${String(s).slice(-4)}` : '');
  if (clone.image?.zhipu) {
    clone.image.zhipu.hasKey = Boolean(clone.image.zhipu.apiKey);
    clone.image.zhipu.apiKeyMasked = secret(clone.image.zhipu.apiKey);
    delete clone.image.zhipu.apiKey;
  }
  if (clone.ai) {
    clone.ai.hasKey = Boolean(clone.ai.apiKey);
    clone.ai.apiKeyMasked = secret(clone.ai.apiKey);
    delete clone.ai.apiKey;
  }
  return clone;
}

/* ---------- 生图 ---------- */

function comfyWorkflow(cfg, { prompt, negative, width, height, seed }) {
  const c = cfg.image.comfyui;
  const neg = negative || 'lowres, blurry, bad anatomy, extra fingers, watermark, text, logo, jpeg artifacts, signature, frame';
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: c.checkpoint } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: neg, clip: ['1', 1] } },
    4: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    5: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: Number(c.steps) || 28,
        cfg: Number(c.cfg) || 6.5,
        sampler_name: c.sampler || 'dpmpp_2m',
        scheduler: c.scheduler || 'karras',
        denoise: 1.0,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0]
      }
    },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { filename_prefix: 'worldforge', images: ['6', 0] } }
  };
}

async function comfyProbe(cfg) {
  const base = cfg.image.comfyui.baseURL.replace(/\/$/, '');
  const res = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`ComfyUI 返回 ${res.status}`);
  const stats = await res.json();
  let checkpoints = [];
  try {
    const info = await (await fetch(`${base}/object_info/CheckpointLoaderSimple`, { signal: AbortSignal.timeout(8000) })).json();
    checkpoints = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
  } catch {
    /* 拿不到列表不致命 */
  }
  return { reachable: true, stats, checkpoints };
}

async function comfyGenerate(cfg, opts) {
  const c = cfg.image.comfyui;
  const base = c.baseURL.replace(/\/$/, '');
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const workflow = comfyWorkflow(cfg, { ...opts, seed });

  let res;
  try {
    res = await fetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: `worldforge-${crypto.randomUUID()}` }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (err) {
    throw new Error(`连不上 ComfyUI（${base}）：${err.message}。它启动了吗？可以双击 ComfyUI 目录里的启动脚本。`);
  }
  const queued = await res.json().catch(() => null);
  if (!res.ok || !queued?.prompt_id) {
    throw new Error(`ComfyUI 拒绝了任务：${JSON.stringify(queued?.error ?? queued).slice(0, 400)}`);
  }
  const promptId = queued.prompt_id;

  const deadline = Date.now() + (Number(c.timeoutMs) || 300000);
  let entry = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const hist = await (await fetch(`${base}/history/${promptId}`, { signal: AbortSignal.timeout(8000) })).json();
      entry = hist?.[promptId];
      if (entry?.status?.status_str === 'error') {
        throw new Error(`ComfyUI 执行出错：${JSON.stringify(entry.status).slice(0, 400)}`);
      }
      if (entry?.outputs && Object.keys(entry.outputs).length) break;
      entry = null;
    } catch (err) {
      if (String(err.message).includes('ComfyUI 执行出错')) throw err;
      // 网络抖动继续等
    }
  }
  if (!entry) throw new Error(`等待 ComfyUI 超时（${Math.round((Number(c.timeoutMs) || 300000) / 1000)} 秒）`);

  const images = Object.values(entry.outputs).flatMap((o) => o.images ?? []);
  if (!images.length) throw new Error('ComfyUI 完成但没有产出图片');

  const file = images[0];
  const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? '', type: file.type ?? 'output' });
  const imgRes = await fetch(`${base}/view?${q}`, { signal: AbortSignal.timeout(60000) });
  if (!imgRes.ok) throw new Error(`取图失败：HTTP ${imgRes.status}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  return { buffer: buf, ext: path.extname(file.filename) || '.png', seed };
}

const ZHIPU_SIZES = {
  '1:1': '1280x1280',
  '3:2': '1568x1056',
  '2:3': '1056x1568',
  '4:3': '1472x1088',
  '3:4': '1088x1472',
  '16:9': '1664x928',
  '9:16': '928x1664'
};

async function zhipuGenerate(cfg, opts) {
  const z = cfg.image.zhipu;
  const key = process.env.ZHIPUAI_API_KEY || z.apiKey;
  if (!key) {
    throw new Error('还没填智谱 API Key。到「设置 → 生图」里填，或改用本地 ComfyUI。');
  }
  const size = opts.size && /^\d+x\d+$/.test(opts.size) ? opts.size : ZHIPU_SIZES[opts.aspect] || '1280x1280';
  const base = (z.baseURL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '');
  const res = await fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: z.model || 'glm-image', prompt: opts.prompt, size }),
    signal: AbortSignal.timeout(180000)
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`智谱返回 ${res.status}：${JSON.stringify(payload?.error ?? payload).slice(0, 400)}`);
  }
  const url = payload?.data?.[0]?.url || payload?.data?.[0]?.b64_json;
  if (!url) throw new Error(`智谱响应里没有图片：${JSON.stringify(payload).slice(0, 300)}`);
  if (!/^https?:/.test(url)) return { buffer: Buffer.from(url, 'base64'), ext: '.png' };
  const imgRes = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!imgRes.ok) throw new Error(`下载生成图失败：HTTP ${imgRes.status}`);
  return { buffer: Buffer.from(await imgRes.arrayBuffer()), ext: '.png' };
}

/* ---------- AI 文本辅助 ---------- */

const AI_PRESETS = {
  expand: {
    system:
      '你是一位世界观设定编辑。基于用户给出的既有设定，写出连贯、具体、可用的中文设定内容。避免空泛形容词，给出可被引用的细节。只输出正文。',
    user: (p) =>
      `世界基调：${p.worldStyle || '（未指定）'}\n对象：${p.entity?.name}（${p.entity?.type}）\n已有内容：\n${p.entity?.body || '（空）'}\n\n请补写这个条目的设定，400 字以内，分成 2-3 段。`
  },
  children: {
    system: '你是一位世界观策划。基于父条目推导出合理的下级条目，输出严格的 JSON，不要任何解释文字。',
    user: (p) =>
      `父条目：${p.entity?.name}（${p.entity?.type}）\n内容：${p.entity?.body || ''}\n\n给出 ${p.count || 5} 个子条目，JSON 形如 {"items":[{"type":"character|location|faction|item","name":"...","summary":"一句话"}]}`
  },
  relations: {
    system: '你是一位世界观策划，只输出严格 JSON，不要解释。',
    user: (p) =>
      `角色/势力/地点：\n${(p.entities || [])
        .map((e) => `- ${e.name}${e.type ? `（${e.type}）` : ''}${e.summary ? `：${e.summary}` : ''}`)
        .join('\n')}\n\n推断它们之间最合理的关系，最多 8 条。kind 只能取 ally|enemy|rival|vassal|kin|trade|controls|uses|secret。\nJSON 形如 {"items":[{"from":"名称","to":"名称","kind":"ally","label":"简短说明"}]}`
  },
  extract: {
    system:
      '你是世界观设定编辑。把用户给的文本拆成一条条独立的设定条目，只输出严格 JSON，不要解释，不要 markdown 代码块。',
    user: (p) =>
      `文本：\n"""\n${p.chunk}\n"""\n\n抽取其中的设定条目。每条字段：\n- type："character"|"location"|"faction"|"item" 四选一\n- name：条目名（去掉「设定」「介绍」这类后缀）\n- summary：一句话概括，40 字以内\n- body：保留原文细节，去掉重复，可以用空行分段\n- tags：0-3 个短标签\n\n如果这段文本里没有独立条目（比如只是过场叙述），返回 {"items":[]}。\n输出格式：{"items":[{"type":"","name":"","summary":"","body":"","tags":[]}]}`
  },
  critique: {
    system: '你是一位严厉但有用的世界观审稿人。用中文指出具体矛盾与薄弱处，按优先级列 3-6 条，每条一句话说明问题 + 一句话给改法。',
    user: (p) => `以下是当前世界观摘要，请审稿：\n${p.digest}`
  }
};

async function aiComplete(cfg, payload) {
  const ai = cfg.ai;
  const key = process.env.WORLDFORGE_AI_KEY || ai.apiKey;
  if (!key) throw new Error('还没填 AI 接口的 Key。到「设置 → AI 辅助」里填 baseURL / model / key。');
  const preset = AI_PRESETS[payload.task];
  if (!preset) throw new Error(`未知的 AI 任务：${payload.task}`);
  const messages = [
    { role: 'system', content: preset.system },
    { role: 'user', content: preset.user(payload) }
  ];
  const base = (ai.baseURL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: ai.model || 'deepseek-chat', messages, temperature: 0.8 }),
    signal: AbortSignal.timeout(120000)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`AI 接口返回 ${res.status}：${JSON.stringify(data?.error ?? data).slice(0, 400)}`);
  const text = data?.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('AI 返回了空内容');
  return text;
}

/* ---------- 路由 ---------- */

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (pathname === '/api/health' && method === 'GET') {
    return sendJSON(res, 200, { ok: true, app: 'worldforge', startedAt: STARTED_AT, pid: process.pid });
  }

  if (pathname === '/api/world') {
    const active = await ensureActiveWorld();
    const id = url.searchParams.get('world') || active;
    if (!(await listWorldIds()).includes(id)) return fail(res, 404, `没有这个世界：${id}`);
    if (method === 'GET') {
      const world = await readJsonFile(worldPath(id), {});
      const stat = await fs.stat(worldPath(id));
      return sendJSON(res, 200, { ok: true, id, world, savedAt: stat.mtime.toISOString() });
    }
    if (method === 'PUT' || method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(res, 400, 'world 必须是对象');
      body.meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
      body.meta.updatedAt = new Date().toISOString();
      await writeJsonAtomic(worldPath(id), body);
      return sendJSON(res, 200, { ok: true, id, savedAt: body.meta.updatedAt });
    }
    res.setHeader('allow', 'GET, PUT');
    return fail(res, 405, '方法不允许');
  }

  /* ---------- 世界目录 ---------- */

  if (pathname === '/api/worlds' && method === 'GET') {
    const active = await ensureActiveWorld();
    return sendJSON(res, 200, { ok: true, active, worlds: await listWorlds() });
  }

  if (pathname === '/api/worlds' && (method === 'POST' || method === 'PUT')) {
    const body = await readBody(req);
    const title = String(body?.title || '').trim() || '未命名世界';
    const id = worldId();
    const world = emptyWorld(title);
    world.meta.updatedAt = new Date().toISOString();
    await writeJsonAtomic(worldPath(id), world);
    if (body?.activate !== false) await writeJsonAtomic(STATE_FILE, { active: id });
    return sendJSON(res, 200, { ok: true, id, world, worlds: await listWorlds() });
  }

  const activateMatch = pathname.match(/^\/api\/worlds\/([^/]+)\/activate$/);
  if (activateMatch && method === 'POST') {
    const id = decodeURIComponent(activateMatch[1]);
    if (!(await listWorldIds()).includes(id)) return fail(res, 404, '没有这个世界');
    await writeJsonAtomic(STATE_FILE, { active: id });
    return sendJSON(res, 200, { ok: true, active: id });
  }

  const idMatch = pathname.match(/^\/api\/worlds\/([^/]+)$/);
  if (idMatch) {
    const id = decodeURIComponent(idMatch[1]);
    const ids = await listWorldIds();
    if (!ids.includes(id)) return fail(res, 404, '没有这个世界');

    if (method === 'PATCH' || method === 'PUT') {
      const body = await readBody(req);
      const world = await readJsonFile(worldPath(id), emptyWorld());
      if (body?.title) world.meta.title = String(body.title).trim().slice(0, 60) || world.meta.title;
      if (body?.meta && typeof body.meta === 'object') Object.assign(world.meta, body.meta);
      world.meta.updatedAt = new Date().toISOString();
      await writeJsonAtomic(worldPath(id), world);
      return sendJSON(res, 200, { ok: true, id, title: world.meta.title, worlds: await listWorlds() });
    }

    if (method === 'DELETE') {
      await fs.unlink(worldPath(id)).catch(() => {});
      const rest = await listWorldIds();
      let active = (await readState()).active;
      if (active === id || !rest.includes(active)) {
        active = rest[0] || worldId();
        if (!rest.length) await writeJsonAtomic(worldPath(active), emptyWorld());
        await writeJsonAtomic(STATE_FILE, { active });
      }
      return sendJSON(res, 200, { ok: true, active, worlds: await listWorlds() });
    }

    res.setHeader('allow', 'PATCH, DELETE');
    return fail(res, 405, '方法不允许');
  }

  if (pathname === '/api/config') {
    const cfg = mergeConfig(structuredClone(DEFAULT_CONFIG), await readJsonFile(CONFIG_FILE, {}));
    if (method === 'GET') return sendJSON(res, 200, { ok: true, config: publicConfig(cfg) });
    if (method === 'PUT' || method === 'POST') {
      const patch = await readBody(req);
      if (!patch || typeof patch !== 'object') return fail(res, 400, 'config 必须是对象');
      // 空 key 表示“保持原值”，避免前端掩码值覆盖真 key
      if (patch?.image?.zhipu && patch.image.zhipu.apiKey === '') delete patch.image.zhipu.apiKey;
      if (patch?.ai && patch.ai.apiKey === '') delete patch.ai.apiKey;
      const merged = mergeConfig(cfg, patch);
      await writeJsonAtomic(CONFIG_FILE, merged);
      return sendJSON(res, 200, { ok: true, config: publicConfig(merged) });
    }
    res.setHeader('allow', 'GET, PUT');
    return fail(res, 405, '方法不允许');
  }

  if (pathname === '/api/images/probe' && method === 'GET') {
    const cfg = mergeConfig(structuredClone(DEFAULT_CONFIG), await readJsonFile(CONFIG_FILE, {}));
    const out = { comfyui: { reachable: false }, zhipu: { hasKey: Boolean(cfg.image.zhipu.apiKey || process.env.ZHIPUAI_API_KEY) } };
    try {
      Object.assign(out.comfyui, await comfyProbe(cfg));
    } catch (err) {
      out.comfyui.error = err.message;
    }
    return sendJSON(res, 200, { ok: true, ...out });
  }

  if (pathname === '/api/images/generate' && method === 'POST') {
    const body = await readBody(req);
    if (!body?.prompt || !String(body.prompt).trim()) return fail(res, 400, 'prompt 不能为空');
    const cfg = mergeConfig(structuredClone(DEFAULT_CONFIG), await readJsonFile(CONFIG_FILE, {}));
    const provider = body.provider || cfg.image.provider || 'comfyui';
    const started = Date.now();
    try {
      const result =
        provider === 'zhipu'
          ? await zhipuGenerate(cfg, body)
          : await comfyGenerate(cfg, {
              prompt: String(body.prompt),
              negative: body.negative,
              width: clampSize(body.width, 512, 2048, 1024),
              height: clampSize(body.height, 512, 2048, 1024),
              seed: body.seed
            });
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}${result.ext}`;
      await fs.writeFile(path.join(IMAGES_DIR, name), result.buffer);
      return sendJSON(res, 200, {
        ok: true,
        file: name,
        url: `/images/${name}`,
        provider,
        tookMs: Date.now() - started,
        seed: result.seed ?? null
      });
    } catch (err) {
      return fail(res, 502, err.message);
    }
  }

  if (pathname === '/api/ai' && method === 'POST') {
    const body = await readBody(req);
    const cfg = mergeConfig(structuredClone(DEFAULT_CONFIG), await readJsonFile(CONFIG_FILE, {}));
    try {
      const text = await aiComplete(cfg, body ?? {});
      return sendJSON(res, 200, { ok: true, text });
    } catch (err) {
      return fail(res, 502, err.message);
    }
  }

  return fail(res, 404, `没有这个接口：${pathname}`);
}

function clampSize(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const snapped = Math.round(n / 64) * 64; // SDXL 喜欢 64 的倍数
  return Math.min(max, Math.max(min, snapped));
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  // 生成图另存目录映射到 /images/*
  const target = rel.startsWith('/images/') ? path.join(IMAGES_DIR, rel.slice('/images/'.length)) : path.join(PUBLIC_DIR, rel);
  const base = rel.startsWith('/images/') ? IMAGES_DIR : PUBLIC_DIR;
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(base) + path.sep) && resolved !== path.resolve(base)) {
    return fail(res, 403, '路径越界');
  }
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return fail(res, 404, `找不到 ${rel}`);
  }
  if (stat.isDirectory()) return fail(res, 404, '目录不直接提供');
  res.writeHead(200, {
    'content-type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': rel.startsWith('/images/') ? 'public, max-age=86400' : 'no-cache'
  });
  createReadStream(resolved).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (err) {
    console.error('[worldforge]', err);
    if (!res.headersSent) fail(res, 500, err.message || '服务器内部错误');
    else res.end();
  }
});

server.requestTimeout = 0;
server.headersTimeout = 0;

await ensureDirs();
server.listen(PORT, HOST, () => {
  console.log(`WorldForge 已启动 → http://${HOST}:${PORT}`);
  console.log(`数据目录：${DATA_DIR}`);
});
