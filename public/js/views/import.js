/** 导入整理：把 txt / md 切成设定卡，规则切分或交给 AI 提炼 */

import { store, TYPES, uid } from '../store.js';
import { esc, openModal, toast, confirmDialog } from '../ui.js';
import { api } from '../api.js';

const state = {
  files: [],       // {name, text}
  pasted: '',      // 粘贴的原文
  mode: 'rule',    // rule | ai
  strategy: 'auto',
  candidates: [],
  parsed: false,
  busy: false,
  progress: '',
  relations: [],
  relBusy: false
};

const TYPE_HINTS = {
  location: ['城', '镇', '村', '港', '湾', '岛', '山', '河', '海', '湖', '塔', '宫', '殿', '林', '荒原', '要塞', '废墟', '矿', '码头', '街', '巷', '屋', '桥', '谷', '洞', '特区'],
  faction: ['公会', '议会', '教团', '家族', '势力', '组织', '军团', '王国', '帝国', '骑士团', '帮', '联盟', '部落', '商会', '学派', '宗门'],
  item: ['剑', '刀', '枪', '弓', '药', '器', '灯', '书', '卷', '符', '石', '戒', '铠', '盔', '遗物', '法器', '道具', '钥匙', '镜', '钟', '货币', '手环'],
  concept: ['体系', '制度', '机制', '规则', '文化', '习俗', '风俗', '信仰', '宗教', '语言', '标准', '流程', '等级', '法律', '经济', '技术'],
  character: ['他', '她', '年龄', '性格', '外貌', '说话', '身世', '少年', '少女', '老人', '男子', '女子', '师父', '徒弟']
};

export function guessType(text = '') {
  let best = 'character';
  let bestScore = 0;
  for (const [type, words] of Object.entries(TYPE_HINTS)) {
    let score = 0;
    for (const w of words) {
      const hits = text.split(w).length - 1;
      score += hits;
    }
    // 标题里出现的关键词权重更高
    if (score > bestScore) {
      bestScore = score;
      best = type;
    }
  }
  return best;
}

/* ---------- 行分类：先认出「什么是什么」，再谈切分 ---------- */

const L = {
  divider: /^[\s]*([-—_=*]\s*){3,}$/,
  md1: /^#{1,2}\s+\S/,
  md2: /^#{3,6}\s+\S/,
  h1cn: /^[一二三四五六七八九十百]+[、.]\s*\S/,
  h1ch: /^第[一二三四五六七八九十百]+[章节篇部]/,
  h2num: /^\d{1,2}[.、)）]\s*\S/,
  h2paren: /^[（(][一二三四五六七八九十]+[）)]\s*\S/,
  h2core: /^核心[一二三四五六七八九十]+[：:]/,
  bullet: /^[·•∙▪◦※]\s*/,
  bullet2: /^[-*]\s+/,
  kv: /^([^：:\s]{1,16})[：:]\s*(\S.*)$/
};

function classifyLine(line) {
  const t = line.trim();
  if (!t) return 'blank';
  if (L.divider.test(t)) return 'divider';
  if (L.md1.test(t)) return 'h1';
  if (L.md2.test(t)) return 'h2';
  if (L.h1cn.test(t) || L.h1ch.test(t)) return 'h1';
  if (L.h2num.test(t) && cleanTitle(t).length <= 28) return 'h2';
  if (L.h2paren.test(t) || L.h2core.test(t)) return 'h2';
  if (L.bullet.test(t) || L.bullet2.test(t)) return 'bullet';
  if (/\t/.test(line) || /\S {2,}\S/.test(t)) return 'table';
  if (L.kv.test(t)) return 'kv';
  return 'prose';
}

/** 一行像不像标题（不看上下文） */
function titleish(line) {
  const t = cleanTitle(line);
  if (!t || t.length < 2 || t.length > 22) return false;
  if (/[。，、；！？…]$/.test(t)) return false;
  return /[\u4e00-\u9fa5A-Za-z]/.test(t);
}

/** 把「一、」「2.」「（三）」「#」去掉 */
export function cleanTitle(line) {
  let t = String(line || '').trim();
  t = t
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[【\[「『]\s*/, '')
    .replace(/^[一二三四五六七八九十百]+[、.]\s*/, '')
    .replace(/^第[一二三四五六七八九十百]+[章节篇部]\s*/, '')
    .replace(/^[（(][一二三四五六七八九十]+[）)]\s*/, '')
    .replace(/^\d{1,2}\s*[.、)）]\s*/, '')
    .trim();
  // 只有配对的收尾括号才去掉，别把「适应期（新手保护期）」削成半边
  if (/[】」』]$/.test(t)) t = t.replace(/\s*[】」』]$/, '');
  if (/）$/.test(t) && !/（/.test(t)) t = t.replace(/\s*）$/, '');
  if (/\)$/.test(t) && !/\(/.test(t)) t = t.replace(/\s*\)$/, '');
  return t.replace(/[：:]\s*$/, '').trim();
}

function firstLine(text) {
  const line = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean) || '';
  return line.length <= 24 ? line.replace(/[。，、；：]$/, '') : '';
}

function stripFirstLine(text, title) {
  const lines = String(text).split(/\r?\n/);
  if (cleanTitle(lines[0]) === cleanTitle(title)) return lines.slice(1).join('\n').trim();
  return String(text).trim();
}

/** 把「名字：值」的行抽成结构化字段，剩下的才算正文 */
function splitFields(lines) {
  const fields = {};
  const rest = [];
  for (const line of lines) {
    const t = line.trim();
    const m = t.match(/^([^：:\s]{1,16})[：:]\s*(\S.*)$/);
    if (m && !/^[·•\-*]/.test(t)) fields[m[1].trim()] = m[2].trim();
    else rest.push(line);
  }
  return { fields, rest };
}

function makeBlock(rawTitle, bodyLines) {
  const title = cleanTitle(rawTitle);
  const { fields, rest } = splitFields(bodyLines);
  const body = rest.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const name = fields['名称'] || fields['名字'] || title;
  return { title: name, body, fields, section: title };
}

/**
 * 切分：先按「一、二、」或 # 切成章节；章节里有小标题就按小标题切，
 * 没有就把整章作为一条。逐个项目符号（· - *）不会被误当成标题。
 */
export function splitDocument(text) {
  const raw = String(text || '').split(/\r?\n/);
  const kinds = raw.map(classifyLine);

  // 第二遍：紧跟项目符号 / 表格 / 空行之后的独立短行，也算小标题
  for (let i = 0; i < raw.length; i++) {
    if (kinds[i] !== 'prose') continue;
    if (!titleish(raw[i])) continue;
    const prev = kinds[i - 1];
    if (!(prev === 'blank' || prev === 'divider' || prev === undefined)) continue;
    let j = i + 1;
    while (j < raw.length && kinds[j] === 'blank') j++;
    if (j >= raw.length || ['bullet', 'table', 'h1', 'h2', 'divider'].includes(kinds[j])) kinds[i] = 'h2';
  }

  const h1s = kinds.map((k, i) => (k === 'h1' ? i : -1)).filter((i) => i >= 0);
  const blocks = [];

  const slice = (from, to) => raw.slice(from + 1, to).filter((l) => !L.divider.test(l.trim()));

  if (h1s.length >= 2) {
    h1s.forEach((start, k) => {
      const end = k + 1 < h1s.length ? h1s[k + 1] : raw.length;
      const sub = kinds.map((kk, i) => (kk === 'h2' && i > start && i < end ? i : -1)).filter((i) => i >= 0);

      if (!sub.length) {
        const b = makeBlock(raw[start], slice(start, end));
        if (b.body || Object.keys(b.fields).length) blocks.push(b);
        return;
      }

      // 章节标题下、第一个小标题之前的那段话
      const pre = slice(start, sub[0]);
      const preText = pre.join('\n').trim();
      const emitSection = preText.length > 40;
      if (emitSection) {
        const b = makeBlock(raw[start], pre);
        if (b.body || Object.keys(b.fields).length) blocks.push(b);
      }

      // 只有一个子标题、且章节本身没正文 → 直接拿子标题当条目
      if (sub.length === 1 && !preText) {
        const b = makeBlock(raw[sub[0]], slice(sub[0], end));
        if (b.body || Object.keys(b.fields).length) blocks.push(b);
        return;
      }

      sub.forEach((s, si) => {
        const send = si + 1 < sub.length ? sub[si + 1] : end;
        const lines = si === 0 && !emitSection && preText ? [...pre, ...slice(s, send)] : slice(s, send);
        const b = makeBlock(raw[s], lines);
        if (b.body || Object.keys(b.fields).length) blocks.push(b);
      });
    });
    return { strategy: 'outline', blocks };
  }

  const h2s = kinds.map((k, i) => (k === 'h2' ? i : -1)).filter((i) => i >= 0);
  if (h2s.length >= 2) {
    h2s.forEach((s, si) => {
      const send = si + 1 < h2s.length ? h2s[si + 1] : raw.length;
      const b = makeBlock(raw[s], slice(s, send));
      if (b.body || Object.keys(b.fields).length) blocks.push(b);
    });
    return { strategy: 'title-line', blocks };
  }

  const paras = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  if (paras.length >= 2) {
    return {
      strategy: 'paragraph',
      blocks: paras.map((p) => {
        const t = firstLine(p);
        return { title: t, body: t && p.split(/\r?\n/).length > 1 ? stripFirstLine(p, t) : p, fields: {} };
      })
    };
  }
  const wholeTitle = firstLine(text);
  return {
    strategy: 'whole',
    blocks: [{ title: wholeTitle, body: wholeTitle ? stripFirstLine(text, wholeTitle) || text : text.trim(), fields: {} }]
  };
}

function summarize(text) {
  const line =
    String(text || '')
      .split(/\r?\n/)
      .map((s) => s.replace(/^[·•∙▪◦\-*\s]+/, '').trim())
      .find(Boolean) || '';
  // 「功能：金融、商业」这种行，摘要里只要冒号后面的部分
  const body = line.replace(/^[^：:\s]{1,12}[：:]\s*/, '').replace(/\s+/g, ' ').trim();
  const first = body.split(/[。！？!?]/)[0] || body;
  return first.slice(0, 60);
}

function stripFence(s) {
  return String(s || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
}

function parseJsonLoose(text) {
  const s = stripFence(text);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 没有返回 JSON');
  return JSON.parse(s.slice(start, end + 1));
}

/* ---------- 解析 ---------- */

function parseRule() {
  const out = [];
  for (const f of state.files) {
    const base = f.name.replace(/\.[^.]+$/, '').trim();
    const text = f.text.trim();
    if (!text) continue;
    const firstRaw = text.split(/\r?\n/)[0];
    const first = cleanTitle(firstRaw);
    const generic = base.length <= 2 || /^(设定|设定集|文档|新建|未命名|无标题|untitled|doc|text|txt|\d+)$/i.test(base);
    let name = base || '未命名条目';
    let body = text;
    // 正文第一行是标题（或文件名太泛）时，用第一行当名字
    if (first && first === base) {
      body = stripFirstLine(text, first);
    } else if (generic && first && first.length <= 24 && !/[。！？]$/.test(first)) {
      name = first;
      body = stripFirstLine(text, first);
    }
    out.push(mkCandidate({ name, body: body || text, source: f.name }));
  }

  const pasted = state.pasted.trim();
  if (pasted) {
    const { blocks } = splitDocument(pasted);
    for (const b of blocks) {
      if (!b.body && !b.title) continue;
      out.push(
        mkCandidate({
          name: b.title || firstLine(b.body) || '未命名条目',
          body: b.body || '',
          fields: b.fields,
          source: '粘贴文本'
        })
      );
    }
  }
  return out;
}

function mkCandidate({ name, body, source, type, fields }) {
  const guessed = type || guessType(`${name}\n${String(body).slice(0, 600)}`);
  const f = fields && Object.keys(fields).length ? fields : {};
  const cleanName = String(name || '未命名条目').trim().slice(0, 40);
  let summary = summarize(body);
  // 摘要不能等于名字本身
  if (!summary || summary === cleanName) {
    const alt = Object.values(f).find((v) => v && String(v).trim() !== cleanName) || '';
    summary = String(alt).slice(0, 60);
  }
  return {
    key: uid('cand'),
    include: true,
    type: guessed,
    name: cleanName,
    summary,
    body: String(body || '').trim(),
    fields: f,
    tags: [],
    source
  };
}

async function parseAI(setProgress) {
  const chunks = [];
  const pushChunk = (text) => {
    const clean = String(text || '').trim();
    if (clean.length < 20) return;
    if (clean.length <= 1800) return chunks.push(clean);
    const paras = clean.split(/\n{2,}/);
    let buf = '';
    for (const p of paras) {
      if ((buf + '\n\n' + p).length > 1800) {
        if (buf) chunks.push(buf.trim());
        buf = p;
      } else {
        buf = buf ? `${buf}\n\n${p}` : p;
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
  };

  for (const f of state.files) pushChunk(f.text);
  pushChunk(state.pasted);

  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    setProgress(`AI 解析中 ${i + 1}/${chunks.length}…`);
    let items = [];
    try {
      const raw = await api.ai('extract', { chunk: chunks[i] });
      const data = parseJsonLoose(raw);
      items = Array.isArray(data.items) ? data.items : [];
    } catch (err) {
      console.warn('[import] chunk failed', err);
      // 一段失败不致命，用规则兜底
      const { blocks } = splitDocument(chunks[i]);
      items = blocks.map((b) => ({ type: guessType(b.title + b.body), name: b.title || firstLine(b.body), summary: summarize(b.body), body: b.body, tags: [] }));
    }
    for (const it of items) {
      if (!it?.name) continue;
      out.push({
        key: uid('cand'),
        include: true,
        type: TYPES[it.type] ? it.type : guessType(`${it.name} ${it.body || ''}`),
        name: String(it.name).slice(0, 40),
        summary: String(it.summary || summarize(it.body || '')).slice(0, 120),
        body: String(it.body || '').trim(),
        tags: Array.isArray(it.tags) ? it.tags.slice(0, 4).map((t) => String(t).slice(0, 12)) : [],
        source: 'AI'
      });
    }
  }
  setProgress('');
  return out;
}

/* ---------- 向导 ---------- */

export function openImportWizard({ onDone } = {}) {
  state.files = [];
  state.pasted = '';
  state.candidates = [];
  state.parsed = false;
  state.relations = [];
  state.busy = false;
  state.progress = '';

  const body = `
    <div id="imp-drop" style="border:1px dashed var(--line);border-radius:10px;padding:22px;text-align:center;color:var(--ink-dim);cursor:pointer;transition:border-color .15s">
      <div style="font-family:var(--serif);font-size:15px;color:var(--ink)">把 txt / md 拖进来，或点这里选文件</div>
      <div class="muted small" style="margin-top:6px">一个设定一个文件、或者一整篇大文档都可以</div>
      <input type="file" id="imp-file" multiple accept=".txt,.md,.markdown,.json,text/plain" hidden />
    </div>

    <div class="field">
      <label>或者直接粘贴（一整个文档也行）</label>
      <textarea id="imp-paste" rows="5" placeholder="把设定正文粘进来，标题行、空行分段都能识别…"></textarea>
    </div>

    <div class="row" style="align-items:flex-end">
      <div class="field">
        <label>处理方式</label>
        <div class="chips">
          <button class="chip on" data-mode="rule">纯规则切分（离线）</button>
          <button class="chip" data-mode="ai">规则 + AI 提炼</button>
        </div>
      </div>
      <div class="field" style="max-width:200px">
        <label>切分依据</label>
        <select id="imp-strategy">
          <option value="auto">自动判断</option>
          <option value="file">每个文件一条</option>
          <option value="heading">按 # 标题</option>
          <option value="paragraph">按空行分段</option>
          <option value="whole">整篇作为一条</option>
        </select>
      </div>
      <button class="btn primary" id="imp-parse" style="flex:none">解析</button>
    </div>

    <div class="muted small" id="imp-hint">AI 模式会把文本分块发给模型，按字数消耗额度；规则模式完全不联网。</div>

    <div class="hr"></div>

    <div id="imp-list"></div>
  `;

  const m = openModal({
    title: '导入整理',
    body,
    footer: `<span class="muted small" id="imp-count">还没有解析</span>
      <button class="btn ghost small" id="imp-relate" hidden>推断关系</button>
      <span class="spacer"></span>
      <button class="btn" data-close2>取消</button>
      <button class="btn primary" id="imp-commit" disabled>导入</button>`
  });

  const root = m.root;
  const list = root.querySelector('#imp-list');
  const hint = root.querySelector('#imp-hint');
  const countEl = root.querySelector('#imp-count');
  const commitBtn = root.querySelector('#imp-commit');
  const relateBtn = root.querySelector('#imp-relate');

  const syncStrategy = (mode) => {
    const sel = root.querySelector('#imp-strategy');
    sel.innerHTML =
      mode === 'ai'
        ? `<option value="auto">自动分块</option><option value="file">每个文件一条</option>`
        : `<option value="auto">自动判断</option><option value="file">每个文件一条</option><option value="heading">按 # 标题</option><option value="paragraph">按空行分段</option><option value="whole">整篇作为一条</option>`;
    state.strategy = 'auto';
  };

  root.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.onclick = () => {
      state.mode = btn.dataset.mode;
      root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b === btn));
      syncStrategy(state.mode);
      hint.textContent =
        state.mode === 'ai'
          ? 'AI 模式会分块调用模型；接口没填 key 时会退回规则切分。'
          : '规则模式：按标题 / 独立短行 / 空行切，全程本地，不花额度。';
    };
  });

  // 选文件
  const fileInput = root.querySelector('#imp-file');
  const drop = root.querySelector('#imp-drop');
  drop.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    await addFiles([...fileInput.files]);
    fileInput.value = '';
  };
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.style.borderColor = 'var(--amber)';
  });
  drop.addEventListener('dragleave', () => (drop.style.borderColor = 'var(--line)'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.style.borderColor = 'var(--line)';
    const files = [...e.dataTransfer.files].filter((f) => /\.(txt|md|markdown)$/i.test(f.name) || f.type.startsWith('text/'));
    await addFiles(files);
  });

  async function addFiles(files) {
    for (const f of files) {
      const text = await f.text();
      state.files.push({ name: f.name, text });
    }
    renderFileList();
  }

  root.querySelector('#imp-paste').addEventListener('input', (e) => {
    state.pasted = e.target.value;
  });

  function renderFileList() {
    const box = root.querySelector('#imp-drop');
    const names = state.files.map((f) => `<span class="tag">${esc(f.name)} · ${f.text.length} 字</span>`).join(' ');
    if (names) {
      box.innerHTML = `<div class="muted small" style="margin-bottom:8px">已选 ${state.files.length} 个文件</div><div style="display:flex;flex-wrap:wrap;gap:6px">${names}</div>`;
      box.onclick = () => fileInput.click();
      box.appendChild(fileInput);
    }
  }

  root.querySelector('#imp-parse').onclick = async (e) => {
    const btn = e.currentTarget;
    if (!state.files.length && !state.pasted.trim()) return toast('先拖文件或粘一段文本', 'err');
    btn.disabled = true;
    state.busy = true;
    countEl.textContent = state.mode === 'ai' ? 'AI 解析中…' : '解析中…';
    try {
      let items;
      if (state.mode === 'ai') {
        items = await parseAI((p) => (countEl.textContent = p));
        if (!items.length) {
          toast('AI 没抽出东西，已退回规则切分', 'err');
          items = parseRule();
        }
      } else {
        items = parseRule();
        if (state.strategy !== 'auto' && state.strategy !== 'file' && state.pasted.trim()) {
          const forced = forceStrategy(state.pasted, state.strategy);
          const others = items.filter((i) => i.source !== '粘贴文本');
          items = [...others, ...forced];
        }
      }
      state.candidates = dedupe(items);
      state.parsed = true;
      renderCandidates();
      const n = state.candidates.filter((c) => c.include).length;
      countEl.textContent = `解析出 ${state.candidates.length} 条`;
      commitBtn.disabled = n === 0;
      commitBtn.textContent = `导入 ${n} 条`;
      relateBtn.hidden = state.mode !== 'ai' || state.candidates.length < 2;
    } catch (err) {
      toast(err.message, 'err', 6000);
    } finally {
      btn.disabled = false;
      state.busy = false;
    }
  };

  function forceStrategy(text, strategy) {
    if (strategy === 'whole') return [mkCandidate({ name: firstLine(text) || '未命名条目', body: text, source: '粘贴文本' })];
    if (strategy === 'paragraph') {
      return text
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .filter((s) => s.length > 8)
        .map((s) => mkCandidate({ name: firstLine(s) || '未命名条目', body: s, source: '粘贴文本' }));
    }
    const { blocks } = splitDocument(text);
    return blocks.map((b) => mkCandidate({ name: b.title || firstLine(b.body) || '未命名条目', body: b.body || b.title, source: '粘贴文本' }));
  }

  function dedupe(items) {
    const seen = new Map();
    const out = [];
    for (const it of items) {
      const key = it.name.replace(/\s+/g, '');
      if (seen.has(key)) {
        // 同名合并正文
        const prev = seen.get(key);
        if (it.body && !prev.body.includes(it.body.slice(0, 30))) prev.body += `\n\n${it.body}`;
        continue;
      }
      seen.set(key, it);
      out.push(it);
    }
    return out;
  }

  function renderCandidates() {
    if (!state.candidates.length) {
      list.innerHTML = `<div class="empty"><strong>没切出条目</strong>换个切分方式，或者检查文本里有没有标题行。</div>`;
      return;
    }
    list.innerHTML = `
      <div class="row" style="align-items:center;margin-bottom:10px">
        <div class="chips">
          <button class="chip" data-bulk="all">全选</button>
          <button class="chip" data-bulk="none">全不选</button>
          <span class="muted small" style="align-self:center;margin-left:6px">批量设为</span>
          ${store.allTypes().map((tp) => `<button class="chip" data-bulk-type="${esc(tp.id)}">${esc(tp.label)}</button>`).join('')}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${state.candidates
          .map(
            (c, i) => `<div class="rel-item" data-cand="${c.key}" style="align-items:flex-start;gap:10px;padding:10px">
              <input type="checkbox" data-inc ${c.include ? 'checked' : ''} style="margin-top:4px;width:15px;height:15px" />
              <select data-type style="max-width:90px;padding:4px 6px;font-size:12px">
                ${store.allTypes().map((tp) => `<option value="${esc(tp.id)}" ${c.type === tp.id ? 'selected' : ''}>${esc(tp.label)}</option>`).join('')}
              </select>
              <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
                <input type="text" data-name value="${esc(c.name)}" style="padding:4px 8px;font-size:12.5px" />
                <input type="text" data-sum value="${esc(c.summary)}" class="muted" style="padding:4px 8px;font-size:11.5px" />
                <div class="muted" style="font-size:10.5px">${c.body.length} 字${
                  Object.keys(c.fields || {}).length ? ` · ${Object.keys(c.fields).length} 个字段` : ''
                } · ${esc(c.source)}</div>
              </div>
              <button class="btn ghost small" data-drop title="去掉这条">✕</button>
            </div>`
          )
          .join('')}
      </div>`;

    list.oninput = (e) => {
      const row = e.target.closest('[data-cand]');
      if (!row) return;
      const c = state.candidates.find((x) => x.key === row.dataset.cand);
      if (!c) return;
      if (e.target.hasAttribute('data-inc')) c.include = e.target.checked;
      if (e.target.hasAttribute('data-name')) c.name = e.target.value;
      if (e.target.hasAttribute('data-sum')) c.summary = e.target.value;
      syncCount();
    };
    list.onchange = (e) => {
      const row = e.target.closest('[data-cand]');
      if (!row || !e.target.hasAttribute('data-type')) return;
      const c = state.candidates.find((x) => x.key === row.dataset.cand);
      if (c) c.type = e.target.value;
    };
    list.onclick = (e) => {
      const bulk = e.target.closest('[data-bulk]');
      const bulkType = e.target.closest('[data-bulk-type]');
      const drop = e.target.closest('[data-drop]');
      if (bulk) {
        const all = bulk.dataset.bulk === 'all';
        state.candidates.forEach((c) => (c.include = all));
        renderCandidates();
        syncCount();
      } else if (bulkType) {
        state.candidates.forEach((c) => {
          if (c.include) c.type = bulkType.dataset.bulkType;
        });
        renderCandidates();
      } else if (drop) {
        const row = drop.closest('[data-cand]');
        state.candidates = state.candidates.filter((c) => c.key !== row.dataset.cand);
        renderCandidates();
        syncCount();
      }
    };
  }

  function syncCount() {
    const n = state.candidates.filter((c) => c.include).length;
    countEl.textContent = `已选 ${n} / ${state.candidates.length}`;
    commitBtn.disabled = n === 0;
    commitBtn.textContent = `导入 ${n} 条`;
    relateBtn.hidden = state.mode !== 'ai' || state.candidates.length < 2;
  }

  // 推断关系
  relateBtn.onclick = async () => {
    const picked = state.candidates.filter((c) => c.include);
    if (picked.length < 2) return toast('至少选两条');
    relateBtn.disabled = true;
    relateBtn.textContent = '推断中…';
    try {
      const raw = await api.ai('relations', { entities: picked.map((c) => ({ name: c.name, type: c.type, summary: c.summary })) });
      const data = parseJsonLoose(raw);
      const nameSet = new Set(picked.map((c) => c.name));
      state.relations = (data.items || [])
        .filter((r) => nameSet.has(r.from) && nameSet.has(r.to) && r.from !== r.to)
        .map((r) => ({ ...r, include: true, key: uid('rel') }));
      renderRelations();
    } catch (err) {
      toast(err.message, 'err', 6000);
    } finally {
      relateBtn.disabled = false;
      relateBtn.textContent = '推断关系';
    }
  };

  function renderRelations() {
    if (!state.relations.length) return;
    const box = document.createElement('div');
    box.innerHTML = `<div class="section-title" style="margin:16px 0 8px">推断出的关系</div>
      <div class="rel-list">${state.relations
        .map(
          (r) => `<label class="rel-item"><input type="checkbox" data-rel ${r.include ? 'checked' : ''} />
            <span>${esc(r.from)}</span><span class="kind">${esc(r.kind || 'ally')}</span><span>${esc(r.to)}</span>
            <span class="label">${esc(r.label || '')}</span></label>`
        )
        .join('')}</div>`;
    list.appendChild(box);
    box.onchange = (e) => {
      const lab = e.target.closest('label');
      const idx = [...box.querySelectorAll('[data-rel]')].indexOf(e.target);
      if (state.relations[idx]) state.relations[idx].include = e.target.checked;
    };
  }

  commitBtn.onclick = () => {
    const picked = state.candidates.filter((c) => c.include && c.name.trim());
    if (!picked.length) return toast('没有可导入的条目');
    const before = store.world.entities.length;
    let added = 0;
    store.commit((w) => {
      const ringR = Math.min(430, 130 + (w.entities.length + picked.length) * 16);
      const base = w.entities.length;
      picked.forEach((c, i) => {
        if (w.entities.some((e) => e.name === c.name.trim())) return;
        const a = ((base + i) / Math.max(1, base + picked.length)) * Math.PI * 2 - Math.PI / 2;
        w.entities.push({
          id: uid('ent'),
          type: c.type,
          name: c.name.trim(),
          aliases: [],
          summary: c.summary,
          body: c.body,
          tags: c.tags || [],
          fields: c.fields || {},
          images: [],
          graph: { x: Math.round(Math.cos(a) * ringR), y: Math.round(Math.sin(a) * ringR * 0.72) },
          createdAt: new Date().toISOString()
        });
        added++;
      });
      const byName = new Map(w.entities.map((e) => [e.name, e.id]));
      for (const r of state.relations.filter((r) => r.include)) {
        const from = byName.get(r.from);
        const to = byName.get(r.to);
        if (from && to) w.relations.push({ id: uid('rel'), from, to, kind: r.kind || 'ally', label: r.label || '' });
      }
    });
    m.close();
    toast(`导入 ${added} 条${state.relations.filter((r) => r.include).length ? ` · ${state.relations.filter((r) => r.include).length} 条关系` : ''}（原有 ${before} 条）`);
    if (onDone) onDone();
    location.hash = '#/cards';
  };

  root.querySelector('[data-close2]').onclick = () => m.close();
  return m;
}
