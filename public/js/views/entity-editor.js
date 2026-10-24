/** 设定卡编辑器（弹窗）：新增 / 编辑实体、结构化字段、关系、图集 */

import { store, TYPES, REL_KINDS, uid, splitList } from '../store.js';
import { esc, openModal, confirmDialog, toast, promptDialog, inlineMd } from '../ui.js';
import { t } from '../i18n.js';
import { api } from '../api.js';

const typeOptions = (sel) =>
  store
    .allTypes()
    .map((tp) => `<option value="${esc(tp.id)}" ${tp.id === sel ? 'selected' : ''}>${esc(t(tp.label))}</option>`)
    .join('');

const kindOptions = (sel) =>
  Object.entries(REL_KINDS)
    .map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${t(v.label)}</option>`)
    .join('');

const entityOptions = (sel, exclude) =>
  store.world.entities
    .filter((e) => e.id !== exclude)
    .map((e) => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${esc(e.name)} (${t(store.typeMeta(e.type).label)})</option>`)
    .join('');

/** 从实体推导一段适合生图的提示词 */
export function composePrompt(entity, extra = '') {
  const meta = store.world.meta;
  const style = meta.worldStyle || 'fantasy concept art, painterly';
  const typeHint = {
    character: 'character portrait, upper body, three-quarter view, atmospheric background',
    location: 'wide establishing shot, landscape, environment concept art',
    faction: 'heraldic emblem, faction insignia, banner, symbol design',
    item: 'still life, single object on dark surface, studio lighting, ornate detail'
  }[entity?.type] || 'concept art';
  const bits = [entity?.name, entity?.summary, extra].filter(Boolean).join(', ');
  return `${bits} — ${typeHint} — ${style}`;
}

export function openEntityEditor(id = null, { presetType = 'character' } = {}) {
  const existing = id ? store.entity(id) : null;
  const draft = existing
    ? structuredClone(existing)
    : {
        id: uid('ent'),
        type: presetType,
        name: '',
        aliases: [],
        summary: '',
        body: '',
        tags: [],
        fields: {},
        images: [],
        graph: { x: 0, y: 0 }
      };
  let rels = existing
    ? store.relationsOf(id).map((r) => ({ ...r }))
    : [];

  const fieldRows = () =>
    Object.entries(draft.fields)
      .map(
        ([k, v], i) => `<div class="row" data-field-row="${i}" style="margin-bottom:6px">
          <input type="text" data-fk value="${esc(k)}" placeholder="字段名" style="max-width:140px" />
          <input type="text" data-fv value="${esc(v)}" placeholder="值" />
          <button class="btn ghost small" data-fdel title="删除">✕</button>
        </div>`
      )
      .join('');

  const relRows = () =>
    rels.length
      ? rels
          .map((r, i) => {
            const otherId = r.from === draft.id ? r.to : r.from;
            const outgoing = r.from === draft.id;
            return `<div class="rel-item" data-rel-row="${i}">
              <span class="kind">${esc(REL_KINDS[r.kind]?.label || r.kind)}</span>
              <select data-rk style="max-width:96px;padding:3px 6px;font-size:11.5px">${kindOptions(r.kind)}</select>
              <select data-rt style="max-width:150px;padding:3px 6px;font-size:11.5px">${entityOptions(otherId, draft.id)}</select>
              <button class="btn ghost small" data-rswap title="切换方向">${outgoing ? '→' : '←'}</button>
              <input type="text" data-rl value="${esc(r.label)}" placeholder="关系说明" style="font-size:12px;padding:4px 8px" />
              <button class="btn ghost small" data-rdel title="删除">✕</button>
            </div>`;
          })
          .join('')
      : '<div class="muted small">还没有关系。可以在这里连，也可以在「关系图」里拖出来。</div>';

  const imagesHtml = () =>
    draft.images.length
      ? `<div class="gallery">${draft.images
          .map(
            (f, i) => `<div class="shot"><img src="/images/${esc(f)}" alt="" /><button class="btn ghost small del" data-imgdel="${i}">✕</button></div>`
          )
          .join('')}</div>`
      : `<div class="muted small">还没有配图。到「生图工坊」按这个条目生成，会自动挂回来。</div>`;

  const body = `
    <div class="form-grid">
      <div class="field"><label>名称</label><input type="text" data-name value="${esc(draft.name)}" placeholder="比如：空湾" /></div>
      <div class="field"><label>类型</label><select data-type>${typeOptions(draft.type)}</select></div>
      <div class="field full"><label>别名（逗号分隔）</label><input type="text" data-aliases value="${esc(draft.aliases.join('，'))}" /></div>
      <div class="field full"><label>一句话</label><input type="text" data-summary value="${esc(draft.summary)}" placeholder="一句话说清它是什么" /></div>
      <div class="field full"><label>标签（逗号分隔）</label><input type="text" data-tags value="${esc(draft.tags.join('，'))}" /></div>
    </div>

    <div class="field">
      <label>正文 <span class="muted" style="text-transform:none;letter-spacing:0">— 空行分段，支持加粗</span></label>
      <textarea data-body rows="8" placeholder="写设定正文…">${esc(draft.body)}</textarea>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn small" data-ai-expand>AI 扩写这段</button>
        <span class="muted small" data-ai-hint></span>
      </div>
    </div>

    <div>
      <div class="section-title" style="margin:4px 0 10px">结构化字段</div>
      <div data-fields>${fieldRows()}</div>
      <button class="btn small" data-fadd>＋ 加一行</button>
    </div>

    <div>
      <div class="section-title" style="margin:4px 0 10px">关系</div>
      <div class="rel-list" data-rels>${relRows()}</div>
      <div class="row" style="margin-top:8px">
        <select data-newrel style="max-width:200px"><option value="">选择另一个条目…</option>${entityOptions('', draft.id)}</select>
        <button class="btn small" data-reladd disabled>＋ 连一条</button>
      </div>
    </div>

    <div>
      <div class="section-title" style="margin:4px 0 10px">图集</div>
      <div data-images>${imagesHtml()}</div>
      <div class="row" style="margin-top:8px;max-width:260px">
        <button class="btn small" data-go-studio>去生图工坊</button>
      </div>
    </div>

    <div class="muted small" data-meta></div>
  `;

  const m = openModal({
    title: existing ? `${t('编辑')} · ${existing.name}` : t('新设定卡'),
    body,
    footer: `${existing ? '<button class="btn danger" data-delete>删除</button>' : ''}
      <span class="spacer"></span>
      <button class="btn" data-cancel>取消</button>
      <button class="btn primary" data-save>保存</button>`
  });
  const root = m.root;

  // 元信息
  const metaBits = [];
  if (existing) {
    metaBits.push(`创建于 ${new Date(existing.createdAt).toLocaleDateString('zh-CN')}`);
    const evs = store.eventsOf(existing.id);
    if (evs.length) metaBits.push(`出现在 ${evs.length} 个事件里`);
    const backs = store.world.relations.filter((r) => r.to === existing.id);
    if (backs.length) metaBits.push(`被 ${backs.length} 条关系指向`);
  }
  root.querySelector('[data-meta]').textContent = metaBits.join(' · ');

  // 字段增删
  const collectFields = () => {
    const out = {};
    root.querySelectorAll('[data-field-row]').forEach((row) => {
      const k = row.querySelector('[data-fk]').value.trim();
      const v = row.querySelector('[data-fv]').value.trim();
      if (k) out[k] = v;
    });
    return out;
  };
  const renderFields = () => {
    draft.fields = collectFields();
    root.querySelector('[data-fields]').innerHTML = fieldRows();
  };
  root.querySelector('[data-fadd]').onclick = () => {
    draft.fields = collectFields();
    draft.fields[''] = '';
    root.querySelector('[data-fields]').innerHTML = fieldRows();
    const rows = root.querySelectorAll('[data-field-row]');
    rows[rows.length - 1]?.querySelector('[data-fk]')?.focus();
  };
  root.querySelector('[data-fields]').addEventListener('click', (e) => {
    const del = e.target.closest('[data-fdel]');
    if (!del) return;
    const row = del.closest('[data-field-row]');
    const k = row.querySelector('[data-fk]').value.trim();
    draft.fields = collectFields();
    delete draft.fields[k];
    root.querySelector('[data-fields]').innerHTML = fieldRows();
  });

  // 关系
  const renderRels = () => {
    root.querySelector('[data-rels]').innerHTML = relRows();
    root.querySelector('[data-newrel]').innerHTML = `<option value="">选择另一个条目…</option>${entityOptions('', draft.id)}`;
  };
  const syncRelsFromDom = () => {
    root.querySelectorAll('[data-rel-row]').forEach((row, i) => {
      if (!rels[i]) return;
      rels[i].kind = row.querySelector('[data-rk]').value;
      const newTo = row.querySelector('[data-rt]').value;
      if (rels[i].from === draft.id) rels[i].to = newTo;
      else rels[i].from = newTo;
      rels[i].label = row.querySelector('[data-rl]').value;
    });
  };
  root.querySelector('[data-rels]').addEventListener('change', syncRelsFromDom);
  root.querySelector('[data-rels]').addEventListener('input', syncRelsFromDom);
  root.querySelector('[data-rels]').addEventListener('click', (e) => {
    const swap = e.target.closest('[data-rswap]');
    const del = e.target.closest('[data-rdel]');
    if (swap) {
      syncRelsFromDom();
      const i = Number(swap.closest('[data-rel-row]').dataset.relRow);
      const r = rels[i];
      [r.from, r.to] = [r.to, r.from];
      renderRels();
    } else if (del) {
      syncRelsFromDom();
      const i = Number(del.closest('[data-rel-row]').dataset.relRow);
      rels.splice(i, 1);
      renderRels();
    }
  });
  const newRelSelect = root.querySelector('[data-newrel]');
  const addRelBtn = root.querySelector('[data-reladd]');
  newRelSelect.onchange = () => (addRelBtn.disabled = !newRelSelect.value);
  addRelBtn.onclick = () => {
    const otherId = newRelSelect.value;
    if (!otherId) return;
    syncRelsFromDom();
    rels.push({ id: uid('rel'), from: draft.id, to: otherId, kind: 'ally', label: '' });
    newRelSelect.value = '';
    addRelBtn.disabled = true;
    renderRels();
  };

  // 图集
  const renderImages = () => {
    root.querySelector('[data-images]').innerHTML = imagesHtml();
    const del = (e) => {
      const btn = e.target.closest('[data-imgdel]');
      if (!btn) return;
      draft.images.splice(Number(btn.dataset.imgdel), 1);
      renderImages();
    };
    root.querySelector('[data-images]').onclick = del;
  };
  renderImages();

  root.querySelector('[data-go-studio]').onclick = () => {
    save({ silent: true, closeAfter: false });
    m.close();
    location.hash = `#/studio?entity=${encodeURIComponent(draft.id)}`;
  };

  // AI 扩写
  root.querySelector('[data-ai-expand]').onclick = async (e) => {
    const btn = e.currentTarget;
    const hint = root.querySelector('[data-ai-hint]');
    btn.disabled = true;
    hint.textContent = '思考中…';
    try {
      const text = await api.ai('expand', {
        worldStyle: store.world.meta.worldStyle,
        entity: { name: root.querySelector('[data-name]').value || draft.name, type: draft.type, body: root.querySelector('[data-body]').value }
      });
      const ta = root.querySelector('[data-body]');
      ta.value = ta.value.trim() ? `${ta.value.trim()}\n\n${text.trim()}` : text.trim();
      hint.textContent = '已追加，记得保存';
    } catch (err) {
      hint.textContent = '';
      toast(err.message, 'err', 5200);
    } finally {
      btn.disabled = false;
    }
  };

  function save({ silent = false, closeAfter = true } = {}) {
    const name = root.querySelector('[data-name]').value.trim();
    if (!name) {
      toast('名称不能为空', 'err');
      root.querySelector('[data-name]').focus();
      return false;
    }
    draft.name = name;
    draft.type = root.querySelector('[data-type]').value;
    draft.aliases = splitList(root.querySelector('[data-aliases]').value);
    draft.summary = root.querySelector('[data-summary]').value.trim();
    draft.tags = splitList(root.querySelector('[data-tags]').value);
    draft.body = root.querySelector('[data-body]').value;
    draft.fields = collectFields();
    syncRelsFromDom();

    const isNew = !store.entity(draft.id);
    store.commit((w) => {
      const idx = w.entities.findIndex((x) => x.id === draft.id);
      if (idx >= 0) w.entities[idx] = { ...w.entities[idx], ...structuredClone(draft) };
      else w.entities.push(structuredClone(draft));
      w.relations = w.relations.filter((r) => r.from !== draft.id && r.to !== draft.id);
      for (const r of rels) {
        if (!r.to || !store.entity(r.to)) continue;
        w.relations.push({ ...r });
      }
    });
    if (!silent) toast(isNew ? `已创建「${draft.name}」` : `已保存「${draft.name}」`);
    if (closeAfter) m.close();
    return true;
  }

  root.querySelector('[data-save]').onclick = () => save();
  root.querySelector('[data-cancel]').onclick = () => m.close();
  root.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '删除设定卡',
      message: `删掉「${existing.name}」？它的关系会一起消失，事件里的引用会保留但变成空指向。`,
      confirmText: '删除',
      danger: true
    });
    if (!ok) return;
    store.commit((w) => {
      w.entities = w.entities.filter((x) => x.id !== existing.id);
      w.relations = w.relations.filter((r) => r.from !== existing.id && r.to !== existing.id);
      w.events = w.events.map((ev) => ({ ...ev, entityIds: ev.entityIds.filter((x) => x !== existing.id) }));
      w.map.pins = w.map.pins.map((p) => (p.entityId === existing.id ? { ...p, entityId: null } : p));
    });
    m.close();
    toast('已删除');
  });

  // 快捷键：Ctrl+Enter 保存
  root.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });

  setTimeout(() => root.querySelector('[data-name]')?.focus(), 30);
  return m;
}

/** 只读预览（关系图 / 地图里双击用） */
export function openEntityPreview(id) {
  const e = store.entity(id);
  if (!e) return;
  const rels = store.relationsOf(id);
  const meta = store.typeMeta(e.type);
  const body = `
    <div style="display:flex;gap:14px;align-items:center">
      <span class="type-dot" style="background:${meta.color};width:10px;height:10px"></span>
      <div>
        <div style="font-family:var(--serif);font-size:20px">${esc(e.name)}</div>
        <div class="muted small">${meta.label}${e.aliases.length ? ` · ${esc(e.aliases.join(' / '))}` : ''}</div>
      </div>
    </div>
    ${e.summary ? `<p style="font-family:var(--serif);font-size:15px;color:var(--ink-dim);margin:0">${esc(e.summary)}</p>` : ''}
    ${e.body ? `<div style="font-family:var(--serif);font-size:14px;line-height:1.85;color:var(--ink-dim)">${inlineMd(e.body)}</div>` : ''}
    ${Object.keys(e.fields).length ? `<dl class="kv">${Object.entries(e.fields).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    ${
      rels.length
        ? `<div><div class="section-title" style="margin:0 0 10px">关系</div><div class="rel-list">${rels
            .map((r) => {
              const other = store.entity(r.from === id ? r.to : r.from);
              const meta2 = REL_KINDS[r.kind] || { label: r.kind };
              return `<div class="rel-item"><span class="kind">${esc(meta2.label)}</span><span>${esc(other?.name || '（已删除）')}</span><span class="label">${esc(r.label)}</span></div>`;
            })
            .join('')}</div></div>`
        : ''
    }
  `;
  const m = openModal({
    title: e.name,
    body,
    footer: `<span class="spacer"></span><button class="btn" data-close2>关闭</button><button class="btn primary" data-edit>编辑</button>`
  });
  m.root.querySelector('[data-close2]').onclick = () => m.close();
  m.root.querySelector('[data-edit]').onclick = () => {
    m.close();
    openEntityEditor(id);
  };
}
