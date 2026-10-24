/** 生图工坊：本地 ComfyUI / 智谱，一条龙到「挂回设定卡」 */

import { store, uid } from '../store.js';
import { esc, toast, download, openModal } from '../ui.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { composePrompt, openEntityEditor } from './entity-editor.js';

const SIZES = [
  { id: '1:1', label: '方形 1:1', w: 1024, h: 1024, z: '1280x1280', use: '头像 / 立绘 / 器物' },
  { id: '3:2', label: '横幅 3:2', w: 1344, h: 896, z: '1568x1056', use: '城镇远景 / 场景' },
  { id: '2:3', label: '竖幅 2:3', w: 896, h: 1344, z: '1056x1568', use: '人物全身 / 高塔' },
  { id: '16:9', label: '宽幅 16:9', w: 1344, h: 768, z: '1664x928', use: '地图底图 / 全景' },
  { id: '9:16', label: '长幅 9:16', w: 768, h: 1344, z: '928x1664', use: '竖版海报' }
];

const state = {
  entityId: null,
  provider: 'comfyui',
  prompt: '',
  negative: '',
  size: '3:2',
  seed: '',
  checkpoint: '',
  steps: 28,
  cfg: 6.5,
  busy: false,
  preview: null,
  status: null,
  config: null
};

export function mount(root, ctx) {
  const page = document.createElement('div');
  page.className = 'page';
  root.appendChild(page);

  const presetEntity = ctx.params?.get?.('entity') || null;
  if (presetEntity) selectEntity(presetEntity);

  function selectEntity(id) {
    state.entityId = id;
    const ent = store.entity(id);
    if (ent) state.prompt = composePrompt(ent);
  }

  function currentSize() {
    return SIZES.find((s) => s.id === state.size) || SIZES[1];
  }

  function render() {
    const ent = store.entity(state.entityId);
    const size = currentSize();
    page.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">生图工坊</h1>
          <p class="page-sub">本地 ComfyUI 或云端智谱 · 出图后可以一键挂回设定卡或当地图底图</p>
        </div>
        <span class="spacer"></span>
        <div class="status-line" id="prov-status">检测中…</div>
        <button class="btn small" data-refresh-status>重测</button>
      </div>

      <div class="studio">
        <div class="panel" style="display:flex;flex-direction:column;gap:14px;position:sticky;top:18px">
          <div class="field">
            <label>挂到哪个条目</label>
            <select id="ent-select">
              <option value="">不挂（只进图库）</option>
              ${store.world.entities
                .map((e) => `<option value="${e.id}" ${e.id === state.entityId ? 'selected' : ''}>${esc(e.name)}（${store.typeMeta(e.type).label}）</option>`)
                .join('')}
            </select>
          </div>

          <div class="field">
            <label>提示词 <span class="muted" style="text-transform:none;letter-spacing:0">— 英文更稳，中文模型也能读</span></label>
            <textarea id="prompt" rows="6" placeholder="一座建在沉船上的港口，阴天，湿冷…">${esc(state.prompt)}</textarea>
            <div style="display:flex;gap:6px">
              <button class="btn small" data-compose>按条目重写</button>
              <button class="btn small" data-style>套用世界风格</button>
            </div>
          </div>

          <div class="field">
            <label>反向词</label>
            <input type="text" id="negative" value="${esc(state.negative)}" placeholder="留空使用默认（模糊/文字/水印…）" />
          </div>

          <div class="row">
            <div class="field"><label>尺寸</label>
              <select id="size">${SIZES.map((s) => `<option value="${s.id}" ${s.id === state.size ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
            </div>
            <div class="field"><label>种子</label>
              <input type="text" id="seed" value="${esc(state.seed)}" placeholder="留空随机" />
            </div>
          </div>
          <div class="muted small" style="margin-top:-6px">${size.use} · ${size.w}×${size.h}</div>

          <div id="comfy-extra" style="display:${state.provider === 'comfyui' ? 'grid' : 'none'};gap:12px;grid-template-columns:1fr 1fr">
            <div class="field"><label>模型</label><select id="ckpt"></select></div>
            <div class="field"><label>步数</label><input type="number" id="steps" value="${state.steps}" min="8" max="60" /></div>
          </div>

          <button class="btn primary" id="gen" ${state.busy ? 'disabled' : ''}>${state.busy ? '生成中…' : '生成'}</button>
          <div class="muted small" id="gen-hint">SDXL 一张大约 20–60 秒（首次加载模型更久）。</div>
        </div>

        <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
          <div class="preview-box" id="preview">
            ${
              state.preview
                ? `<img src="/images/${encodeURIComponent(state.preview.file)}" alt="" />`
                : `<div class="ph">生成的图会出现在这里<br /><span class="mono">${size.w}×${size.h}</span></div>`
            }
            ${state.busy ? `<div class="progress"><div style="display:flex;flex-direction:column;gap:10px;align-items:center"><div class="spinner"></div><span class="muted small">排队 / 采样中…</span></div></div>` : ''}
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" data-attach ${state.preview && state.entityId ? '' : 'disabled'}>挂到「${esc(ent?.name || '未选条目')}」</button>
            <button class="btn" data-mapbg ${state.preview ? '' : 'disabled'}>设为地图底图</button>
            <button class="btn" data-download ${state.preview ? '' : 'disabled'}>下载</button>
            <button class="btn ghost" data-copy ${state.preview ? '' : 'disabled'}>复制提示词</button>
            ${state.preview ? `<span class="muted small" style="align-self:center">${esc(state.preview.provider)} · ${(state.preview.tookMs / 1000).toFixed(1)}s${state.preview.seed != null ? ` · seed ${state.preview.seed}` : ''}</span>` : ''}
          </div>

          <div class="section-title" style="margin:6px 0 0">图库 <span class="muted small">${store.world.gallery.length} ${esc(t('张'))}</span></div>
          ${
            store.world.gallery.length
              ? `<div class="gallery" id="gallery">
                  ${[...store.world.gallery]
                    .reverse()
                    .map(
                      (g) => `<div class="shot" data-file="${esc(g.file)}" title="${esc(g.prompt).slice(0, 200)}">
                        <img src="/images/${encodeURIComponent(g.file)}" alt="" loading="lazy" />
                        <button class="btn ghost small del" data-delimg="${g.id}">✕</button>
                      </div>`
                    )
                    .join('')}
                </div>`
              : `<div class="empty"><strong>还没有图</strong>写个提示词，点上面的「生成」。</div>`
          }
        </div>
      </div>
    `;

    // 模型下拉 + 状态
    fetchStatus().then(() => {
      const sel = page.querySelector('#ckpt');
      if (!sel) return;
      const ckpts = state.status?.comfyui?.checkpoints || [];
      const chosen = state.checkpoint || state.config?.image?.comfyui?.checkpoint || ckpts[0] || '';
      sel.innerHTML = ckpts.length
        ? ckpts.map((c) => `<option value="${esc(c)}" ${c === chosen ? 'selected' : ''}>${esc(c)}</option>`).join('')
        : `<option value="">${esc(state.config?.image?.comfyui?.checkpoint || '（未连上 ComfyUI）')}</option>`;
    });

    const promptEl = page.querySelector('#prompt');
    promptEl.addEventListener('input', () => (state.prompt = promptEl.value));

    page.querySelector('#ent-select').onchange = (e) => {
      selectEntity(e.target.value || null);
      const entNow = store.entity(state.entityId);
      state.prompt = entNow ? composePrompt(entNow) : state.prompt;
      page.querySelector('#prompt').value = state.prompt;
      render();
    };
    page.querySelector('#negative').oninput = (e) => (state.negative = e.target.value);
    page.querySelector('#size').onchange = (e) => {
      state.size = e.target.value;
      render();
    };
    page.querySelector('#seed').oninput = (e) => (state.seed = e.target.value);
    page.querySelector('#steps').oninput = (e) => (state.steps = Number(e.target.value) || 28);
    page.querySelector('#comfy-extra').querySelector('#ckpt')?.addEventListener('change', (e) => (state.checkpoint = e.target.value));

    page.querySelector('[data-compose]').onclick = () => {
      const ent = store.entity(state.entityId);
      if (!ent) return toast('先选一个条目，或者直接手写提示词');
      state.prompt = composePrompt(ent);
      page.querySelector('#prompt').value = state.prompt;
    };
    page.querySelector('[data-style]').onclick = () => {
      const style = store.world.meta.worldStyle;
      if (!style) return toast('世界风格还是空的，去「设置」里填一句');
      if (state.prompt.includes(style)) return toast('已经套过了');
      state.prompt = `${state.prompt.trim()} — ${style}`;
      page.querySelector('#prompt').value = state.prompt;
    };
    page.querySelector('[data-refresh-status]').onclick = () => {
      state.status = null;
      fetchStatus(true);
    };
    page.querySelector('#gen').onclick = generate;

    page.querySelector('[data-attach]').onclick = attachToEntity;
    page.querySelector('[data-mapbg]').onclick = () => {
      if (!state.preview) return;
      store.commit((w) => (w.map.bg = state.preview.file));
      toast('已设为地图底图');
    };
    page.querySelector('[data-download]').onclick = () => {
      if (!state.preview) return;
      const a = document.createElement('a');
      a.href = `/images/${encodeURIComponent(state.preview.file)}`;
      a.download = state.preview.file;
      a.click();
    };
    page.querySelector('[data-copy]').onclick = async () => {
      await navigator.clipboard?.writeText(state.prompt);
      toast('提示词已复制');
    };

    const gallery = page.querySelector('#gallery');
    if (gallery) {
      gallery.onclick = (e) => {
        const del = e.target.closest('[data-delimg]');
        if (del) {
          e.stopPropagation();
          const id = del.dataset.delimg;
          store.commit((w) => {
            const g = w.gallery.find((x) => x.id === id);
            if (g) {
              w.entities.forEach((en) => (en.images = en.images.filter((f) => f !== g.file)));
              w.map.bg = w.map.bg === g.file ? null : w.map.bg;
            }
            w.gallery = w.gallery.filter((x) => x.id !== id);
          });
          if (state.preview?.file === store.world.gallery.find((x) => x.id === id)?.file) state.preview = null;
          render();
          return;
        }
        const shot = e.target.closest('[data-file]');
        if (shot) {
          const g = store.world.gallery.find((x) => x.file === shot.dataset.file);
          if (g) {
            state.preview = { file: g.file, provider: g.provider, tookMs: 0, seed: null };
            render();
          }
        }
      };
    }
  }

  async function fetchStatus(force = false) {
    const node = page.querySelector('#prov-status');
    try {
      state.config = state.config || (await api.getConfig());
      if (!state.status || force) state.status = await api.probeImages();
      const comfy = state.status.comfyui;
      state.provider = state.config.image.provider || (comfy.reachable ? 'comfyui' : 'zhipu');
      if (node) {
        const ok = state.provider === 'comfyui' ? comfy.reachable : state.status.zhipu.hasKey;
        node.innerHTML = `<span class="dot ${ok ? 'ok' : 'bad'}"></span>
          ${state.provider === 'comfyui'
            ? comfy.reachable
              ? `${esc(t('ComfyUI 在线'))} · ${(comfy.checkpoints || []).length} ${esc(t('个模型'))}`
              : `${esc(t('ComfyUI 未启动'))} (${esc(comfy.error || '')})`
            : state.status.zhipu.hasKey
              ? esc(t('智谱已配置'))
              : esc(t('智谱还没填 Key'))}`;
      }
      const extra = page.querySelector('#comfy-extra');
      if (extra) extra.style.display = state.provider === 'comfyui' ? 'grid' : 'none';
    } catch (err) {
      if (node) node.innerHTML = `<span class="dot bad"></span>${esc(err.message)}`;
    }
  }

  async function generate() {
    if (state.busy) return;
    const prompt = page.querySelector('#prompt').value.trim();
    if (!prompt) return toast('先写提示词', 'err');
    state.prompt = prompt;
    state.busy = true;
    render();
    const size = currentSize();
    const seedRaw = page.querySelector('#seed')?.value.trim();
    try {
      const res = await api.generateImage({
        provider: state.provider,
        prompt,
        negative: page.querySelector('#negative')?.value.trim() || undefined,
        width: size.w,
        height: size.h,
        size: size.z,
        aspect: size.id,
        seed: seedRaw ? Number(seedRaw) : undefined
      });
      state.preview = res;
      store.commit((w) => {
        w.gallery.push({
          id: uid('img'),
          file: res.file,
          prompt,
          provider: res.provider,
          createdAt: new Date().toISOString(),
          entityId: state.entityId || null
        });
        const ent = w.entities.find((e) => e.id === state.entityId);
        if (ent && !ent.images.includes(res.file)) ent.images.push(res.file);
      });
      toast(`出图了 · ${(res.tookMs / 1000).toFixed(1)}s`);
    } catch (err) {
      toast(err.message, 'err', 8000);
    } finally {
      state.busy = false;
      render();
    }
  }

  function attachToEntity() {
    if (!state.preview) return;
    if (!state.entityId) {
      const m = openModal({
        title: '挂到哪个条目',
        narrow: true,
        body: `<div class="field"><label>条目</label><select data-ent>
          ${store.world.entities.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}
        </select></div>`,
        footer: `<span class="spacer"></span><button class="btn primary" data-ok>挂上去</button>`
      });
      m.root.querySelector('[data-ok]').onclick = () => {
        const id = m.root.querySelector('[data-ent]').value;
        const file = state.preview.file;
        store.commit((w) => {
          const ent = w.entities.find((e) => e.id === id);
          if (ent && !ent.images.includes(file)) ent.images.push(file);
          const g = w.gallery.find((x) => x.file === file);
          if (g) g.entityId = id;
        });
        m.close();
        toast('已挂上');
        render();
      };
      return;
    }
    const file = state.preview.file;
    const id = state.entityId;
    let added = true;
    store.commit((w) => {
      const ent = w.entities.find((e) => e.id === id);
      if (ent && !ent.images.includes(file)) ent.images.push(file);
      else added = false;
      const g = w.gallery.find((x) => x.file === file);
      if (g) g.entityId = id;
    });
    toast(added ? `已挂到「${store.entity(id)?.name}」` : '这张图已经挂在这个条目上了');
    render();
  }

  render();
  fetchStatus();
  return { refresh: () => {} };
}
