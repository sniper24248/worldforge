/** 设置：世界信息、生图通道、AI 接口、数据导入导出 */

import { store, TYPES } from '../store.js';
import { esc, toast, download, pickFile, confirmDialog, openModal } from '../ui.js';
import { api } from '../api.js';
import { normalize } from '../store.js';
import { THEMES, getTheme, setTheme, getAccent, setAccent, defaultAccent, themeMeta, themeLabel, themeHint } from '../theme.js';
import { LANGS, getLang, setLang } from '../i18n.js';

let cfg = null;

export function mount(root, ctx) {
  const page = document.createElement('div');
  page.className = 'page';
  root.appendChild(page);

  function render() {
    const meta = store.world.meta;
    const c = cfg;
    const img = c?.image || { provider: 'comfyui', comfyui: {}, zhipu: {} };
    const comfy = img.comfyui || {};
    const zhipu = img.zhipu || {};
    const ai = c?.ai || {};

    page.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">设置</h1>
          <p class="page-sub">世界信息存进 world.json；通道与密钥存在本机 data/config.json，不会上传</p>
        </div>
      </div>

      <div class="section-title" style="margin-top:0">外观</div>
      <div class="panel">
        <div class="theme-grid">
          ${THEMES.map((t) => {
            const on = t.id === getTheme();
            return `<button class="theme-card ${on ? 'on' : ''}" data-theme-id="${t.id}">
              <span class="sw"><i style="background:${t.bg}"></i><i style="background:${t.panel}"></i><i style="background:${t.ink}"></i><i style="background:${t.accent}"></i></span>
              <b>${esc(themeLabel(t))}</b><em>${esc(themeHint(t))}</em>
            </button>`;
          }).join('')}
        </div>
        <div class="row" style="margin-top:16px;align-items:flex-end">
          <div class="field" style="max-width:190px"><label>自定义强调色</label>
            <input type="color" id="accent-color" value="${esc(getAccent() || defaultAccent())}" style="height:38px;padding:3px" />
          </div>
          <button class="btn small" id="accent-reset" style="flex:none">用主题默认色</button>
          <span class="muted small" style="align-self:center">强调色作用于按钮、选中态、关系图节点描边</span>
        </div>
        <div class="row" style="margin-top:14px;align-items:center">
          <div class="field" style="max-width:190px"><label>界面语言 / Language</label>
            <div class="chips" id="lang-chips">
              ${LANGS.map((l) => `<button class="chip ${l.id === getLang() ? 'on' : ''}" data-lang="${l.id}">${esc(l.label)}</button>`).join('')}
            </div>
          </div>
          <span class="muted small" style="align-self:center">English UI is a work in progress — some dialogs are still Chinese.</span>
        </div>
      </div>

      <div class="section-title">世界信息</div>
      <div class="panel">
        <div class="form-grid">
          <div class="field"><label>世界名</label><input type="text" id="w-title" value="${esc(meta.title)}" /></div>
          <div class="field"><label>类型</label><input type="text" id="w-genre" value="${esc(meta.genre)}" placeholder="海洋奇幻 / 低魔" /></div>
          <div class="field full"><label>一句话</label><input type="text" id="w-logline" value="${esc(meta.logline)}" /></div>
          <div class="field full"><label>基调</label><input type="text" id="w-tone" value="${esc(meta.tone)}" /></div>
          <div class="field full"><label>生图风格提示词 <span class="muted" style="text-transform:none;letter-spacing:0">— 英文关键词最稳，会拼到每次生成的提示词末尾</span></label>
            <textarea id="w-style" rows="3">${esc(meta.worldStyle)}</textarea></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="btn primary" id="save-meta">保存世界信息</button>
          <span class="muted small" style="align-self:center">地图画布 ${store.world.map.canvas.w}×${store.world.map.canvas.h}</span>
        </div>
      </div>

      <div class="section-title">生图通道</div>
      <div class="panel">
        <div class="chips" style="margin-bottom:16px">
          <button class="chip ${img.provider !== 'zhipu' ? 'on' : ''}" data-prov="comfyui">本地 ComfyUI</button>
          <button class="chip ${img.provider === 'zhipu' ? 'on' : ''}" data-prov="zhipu">智谱 CogView / GLM-Image</button>
        </div>

        <div class="form-grid">
          <div class="field"><label>ComfyUI 地址</label><input type="text" id="c-url" value="${esc(comfy.baseURL || '')}" /></div>
          <div class="field"><label>默认模型</label><input type="text" id="c-ckpt" value="${esc(comfy.checkpoint || '')}" list="ckpt-list" />
            <datalist id="ckpt-list"></datalist></div>
          <div class="field"><label>步数</label><input type="number" id="c-steps" value="${comfy.steps ?? 28}" min="8" max="80" /></div>
          <div class="field"><label>CFG</label><input type="number" id="c-cfg" value="${comfy.cfg ?? 6.5}" step="0.5" min="1" max="15" /></div>
          <div class="field"><label>采样器</label><input type="text" id="c-sampler" value="${esc(comfy.sampler || 'dpmpp_2m')}" /></div>
          <div class="field"><label>调度器</label><input type="text" id="c-scheduler" value="${esc(comfy.scheduler || 'karras')}" /></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
          <button class="btn small" id="test-comfy">测试连接</button>
          <span class="muted small" id="comfy-result"></span>
        </div>

        <div class="hr"></div>

        <div class="form-grid">
          <div class="field"><label>智谱 API Key</label><input type="password" id="z-key" value="" placeholder="${esc(zhipu.apiKeyMasked || '还没填')}" /></div>
          <div class="field"><label>模型</label><input type="text" id="z-model" value="${esc(zhipu.model || 'glm-image')}" /></div>
          <div class="field full"><label>Base URL</label><input type="text" id="z-base" value="${esc(zhipu.baseURL || 'https://open.bigmodel.cn/api/paas/v4')}" /></div>
        </div>
        <p class="muted small" style="margin:10px 0 0">留空保存会保留原 Key。也可以设环境变量 <span class="mono">ZHIPUAI_API_KEY</span>，优先级更高。</p>
      </div>

      <div class="section-title">AI 文本辅助（可选）</div>
      <div class="panel">
        <p class="muted small" style="margin:0 0 14px">不填就完全关闭，不会消耗任何额度。填了之后「AI 扩写 / 审稿」才会工作。任何 OpenAI 兼容接口都能用。</p>
        <div class="form-grid">
          <div class="field"><label>Base URL</label><input type="text" id="ai-base" value="${esc(ai.baseURL || '')}" placeholder="https://api.deepseek.com/v1" /></div>
          <div class="field"><label>模型</label><input type="text" id="ai-model" value="${esc(ai.model || 'deepseek-chat')}" /></div>
          <div class="field"><label>API Key</label><input type="password" id="ai-key" value="" placeholder="${esc(ai.apiKeyMasked || '还没填')}" /></div>
          <div class="field"><label>&nbsp;</label><button class="btn small" id="test-ai">发一个「ok」测试</button></div>
        </div>
      </div>

      <div style="display:flex;gap:10px;margin:18px 0 6px">
        <button class="btn primary" id="save-config">保存通道设置</button>
        <span class="muted small" style="align-self:center">保存后立刻生效，不用重启</span>
      </div>

      <div class="section-title">数据</div>
      <div class="panel">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn" id="export">导出世界 JSON</button>
          <button class="btn" id="import">导入 JSON</button>
          <button class="btn" id="export-md">导出 Markdown 设定集</button>
          <span class="spacer"></span>
          <button class="btn danger" id="reset">清空所有设定</button>
        </div>
        <p class="muted small" style="margin:12px 0 0">
          数据就在 <span class="mono">worldforge/data/world.json</span>，图片在 <span class="mono">data/images/</span>。
          直接备份这两个地方就等于备份整个世界，也可以放进 git。
        </p>
      </div>

      <div class="muted small" style="margin-top:28px;line-height:1.9">
        WorldForge · 本地优先的世界观工作台 · 前端零依赖，后端零依赖<br />
        当前 ${store.world.entities.length} 个条目 / ${store.world.relations.length} 条关系 / ${store.world.events.length} 个事件 / ${store.world.gallery.length} 张图
      </div>
    `;

    // 外观
    page.querySelectorAll('[data-theme-id]').forEach((btn) => {
      btn.onclick = () => {
        setTheme(btn.dataset.themeId);
        render();
        toast(`配色：${themeMeta().name}`);
      };
    });
    const accentInput = page.querySelector('#accent-color');
    accentInput.oninput = () => setAccent(accentInput.value);
    accentInput.onchange = () => setAccent(accentInput.value);
    page.querySelector('#accent-reset').onclick = () => {
      setAccent('');
      render();
      toast('已恢复主题默认强调色');
    };

    // 语言
    page.querySelectorAll('#lang-chips [data-lang]').forEach((btn) => {
      btn.onclick = () => {
        setLang(btn.dataset.lang);
        location.reload();
      };
    });

    // 世界信息
    page.querySelector('#save-meta').onclick = () => {
      store.commit((w) => {
        w.meta.title = page.querySelector('#w-title').value.trim() || '未命名世界';
        w.meta.genre = page.querySelector('#w-genre').value.trim();
        w.meta.logline = page.querySelector('#w-logline').value.trim();
        w.meta.tone = page.querySelector('#w-tone').value.trim();
        w.meta.worldStyle = page.querySelector('#w-style').value.trim();
      });
      toast('世界信息已保存');
    };

    // 通道切换
    page.querySelectorAll('[data-prov]').forEach((btn) => {
      btn.onclick = async () => {
        cfg.image.provider = btn.dataset.prov;
        await api.saveConfig({ image: { provider: cfg.image.provider } });
        toast(`生图通道：${cfg.image.provider === 'comfyui' ? '本地 ComfyUI' : '智谱'}`);
        render();
      };
    });

    page.querySelector('#test-comfy').onclick = async () => {
      const out = page.querySelector('#comfy-result');
      out.textContent = '连接中…';
      try {
        const res = await api.probeImages();
        if (res.comfyui.reachable) {
          out.innerHTML = `<span style="color:var(--teal)">在线</span>，${(res.comfyui.checkpoints || []).length} 个模型`;
          const dl = page.querySelector('#ckpt-list');
          dl.innerHTML = (res.comfyui.checkpoints || []).map((c) => `<option value="${esc(c)}">`).join('');
        } else {
          out.innerHTML = `<span style="color:var(--rose)">连不上</span>：${esc(res.comfyui.error || '')}`;
        }
      } catch (err) {
        out.textContent = err.message;
      }
    };

    page.querySelector('#test-ai').onclick = async () => {
      const key = page.querySelector('#ai-key').value.trim();
      if (key) await saveConfig({ silent: true });
      try {
        const text = await api.ai('critique', { digest: '测试：请只回复「ok」。' });
        toast(`AI 通路正常：${text.slice(0, 20)}`);
      } catch (err) {
        toast(err.message, 'err', 6000);
      }
    };

    page.querySelector('#save-config').onclick = async () => {
      await saveConfig();
      toast('通道设置已保存');
    };

    // 数据
    page.querySelector('#export').onclick = () => {
      download(`${store.world.meta.title || 'world'}.json`, JSON.stringify(store.world, null, 2));
      toast('已导出');
    };
    page.querySelector('#import').onclick = async () => {
      const file = await pickFile('.json');
      if (!file) return;
      try {
        const parsed = JSON.parse(file.text);
        const ok = await confirmDialog({
          title: '导入世界',
          message: `用「${parsed?.meta?.title || file.name}」覆盖当前世界？当前内容会被替换（可以先导出备份）。`,
          confirmText: '覆盖导入',
          danger: true
        });
        if (!ok) return;
        store.world = normalize(parsed);
        store.scheduleSave(50);
        toast('已导入');
        render();
      } catch (err) {
        toast(`解析失败：${err.message}`, 'err');
      }
    };
    page.querySelector('#export-md').onclick = () => download(`${store.world.meta.title || 'world'}.md`, toMarkdown(), 'text/markdown');
    page.querySelector('#reset').onclick = async () => {
      const ok = await confirmDialog({
        title: '清空所有设定',
        message: '会删掉全部条目、关系、事件和地图。图片文件不会删，但图库记录会清空。这个操作不能撤销。',
        confirmText: '全部清空',
        danger: true
      });
      if (!ok) return;
      store.commit((w) => {
        w.entities = [];
        w.relations = [];
        w.events = [];
        w.gallery = [];
        w.map = { canvas: { w: 1600, h: 1000 }, bg: null, bgOpacity: 0.45, regions: [], pins: [], routes: [] };
      });
      toast('已清空');
      render();
    };
  }

  function readConfigFromForm() {
    return {
      image: {
        provider: cfg?.image?.provider || 'comfyui',
        comfyui: {
          baseURL: page.querySelector('#c-url').value.trim(),
          checkpoint: page.querySelector('#c-ckpt').value.trim(),
          steps: Number(page.querySelector('#c-steps').value) || 28,
          cfg: Number(page.querySelector('#c-cfg').value) || 6.5,
          sampler: page.querySelector('#c-sampler').value.trim() || 'dpmpp_2m',
          scheduler: page.querySelector('#c-scheduler').value.trim() || 'karras'
        },
        zhipu: {
          baseURL: page.querySelector('#z-base').value.trim(),
          model: page.querySelector('#z-model').value.trim() || 'glm-image',
          apiKey: page.querySelector('#z-key').value.trim()
        }
      },
      ai: {
        baseURL: page.querySelector('#ai-base').value.trim(),
        model: page.querySelector('#ai-model').value.trim(),
        apiKey: page.querySelector('#ai-key').value.trim()
      }
    };
  }

  async function saveConfig({ silent = false } = {}) {
    const patch = readConfigFromForm();
    cfg = await api.saveConfig(patch);
    if (!silent) render();
    return cfg;
  }

  function toMarkdown() {
    const w = store.world;
    const lines = [`# ${w.meta.title || '未命名世界'}`, '', w.meta.logline || '', ''];
    if (w.meta.genre) lines.push(`- 类型：${w.meta.genre}`);
    if (w.meta.tone) lines.push(`- 基调：${w.meta.tone}`);
    lines.push('', '## 设定', '');
    for (const [type, meta] of Object.entries(TYPES)) {
      const list = w.entities.filter((e) => e.type === type);
      if (!list.length) continue;
      lines.push(`### ${meta.label}`, '');
      for (const e of list) {
        lines.push(`#### ${e.name}`, '');
        if (e.aliases.length) lines.push(`*别名：${e.aliases.join('、')}*`, '');
        if (e.summary) lines.push(`> ${e.summary}`, '');
        if (e.body) lines.push(e.body, '');
        const fields = Object.entries(e.fields);
        if (fields.length) lines.push(fields.map(([k, v]) => `- **${k}**：${v}`).join('\n'), '');
        const rels = store.relationsOf(e.id);
        if (rels.length) {
          lines.push(
            rels
              .map((r) => {
                const other = store.entity(r.from === e.id ? r.to : r.from);
                return `- 关系：${r.label || ''} → ${other?.name || '?'}（${r.kind}）`;
              })
              .join('\n'),
            ''
          );
        }
        if (e.images.length) lines.push(e.images.map((f) => `![](data/images/${f})`).join('\n'), '');
      }
    }
    if (w.events.length) {
      lines.push('## 时间线', '');
      for (const ev of [...w.events].sort((a, b) => a.year - b.year)) {
        lines.push(`- **第 ${ev.year} 年** ${ev.title}${ev.summary ? `：${ev.summary}` : ''}`);
      }
    }
    return lines.join('\n');
  }

  api
    .getConfig()
    .then((c) => {
      cfg = c;
      render();
    })
    .catch((err) => {
      page.innerHTML = `<div class="empty"><strong>读不到配置</strong>${esc(err.message)}</div>`;
    });

  return { refresh: () => { if (cfg) render(); } };
}
