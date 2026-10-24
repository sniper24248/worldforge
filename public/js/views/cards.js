/** 设定卡库：模糊检索、筛选、网格 */

import { store, TYPES, TYPE_COLORS, TYPE_GLYPHS, uid } from '../store.js';
import { esc, openModal, toast, debounce } from '../ui.js';
import { openEntityEditor } from './entity-editor.js';
import { openImportWizard } from './import.js';
import { t } from '../i18n.js';
import { tokenize, scoreEntity, highlight } from '../search.js';

const state = { q: '', types: new Set(), tag: null, sort: 'type' };

function allTags() {
  const count = new Map();
  for (const e of store.world.entities) for (const tag of e.tags) count.set(tag, (count.get(tag) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
}

/** 先按类型 / 标签过滤，再按模糊得分排序；返回 [{entity, score}] */
function collect() {
  const tokens = tokenize(state.q);
  const out = [];
  for (const entity of store.world.entities) {
    if (state.types.size && !state.types.has(entity.type)) continue;
    if (state.tag && !entity.tags.includes(state.tag)) continue;
    if (!tokens.length) {
      out.push({ entity, score: 0 });
      continue;
    }
    const hit = scoreEntity(entity, tokens);
    if (hit) out.push({ entity, score: hit.score });
  }
  return { list: out, tokens };
}

export function mount(root, ctx) {
  const page = document.createElement('div');
  page.className = 'page';
  root.appendChild(page);

  // 侧边栏点类型进来时带上筛选
  const presetType = ctx.params?.get?.('type');
  if (presetType) {
    state.types.clear();
    state.types.add(presetType);
  }

  function openTypeCreator() {
    const m = openModal({
      title: t('新类型'),
      narrow: true,
      body: `
        <div class="field"><label>${esc(t('名称'))}</label>
          <input type="text" data-label value="" placeholder="${esc(t('比如：生物 / 神话 / 组织'))}" /></div>
        <div class="field" style="margin-top:14px"><label>${esc(t('图标'))}</label>
          <div class="chips" id="tc-glyphs">${TYPE_GLYPHS.map((g, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-glyph="${g}" style="font-size:15px">${g}</button>`).join('')}</div>
        </div>
        <div class="field" style="margin-top:14px"><label>${esc(t('颜色'))}</label>
          <div class="chips" id="tc-colors">${TYPE_COLORS.map((c, i) => `<button class="chip ${i === 5 ? 'on' : ''}" data-color="${c}" style="padding:3px 8px"><i style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${c}"></i></button>`).join('')}</div>
        </div>`,
      footer: `<span class="spacer"></span><button class="btn" data-cancel>${esc(t('取消'))}</button><button class="btn primary" data-ok>${esc(t('创建'))}</button>`
    });
    let glyph = TYPE_GLYPHS[0];
    let color = TYPE_COLORS[5];
    m.root.querySelector('#tc-glyphs').onclick = (e) => {
      const b = e.target.closest('[data-glyph]');
      if (!b) return;
      glyph = b.dataset.glyph;
      m.root.querySelectorAll('#tc-glyphs .chip').forEach((x) => x.classList.toggle('on', x === b));
    };
    m.root.querySelector('#tc-colors').onclick = (e) => {
      const b = e.target.closest('[data-color]');
      if (!b) return;
      color = b.dataset.color;
      m.root.querySelectorAll('#tc-colors .chip').forEach((x) => x.classList.toggle('on', x === b));
    };
    m.root.querySelector('[data-cancel]').onclick = () => m.close();
    m.root.querySelector('[data-ok]').onclick = () => {
      const label = m.root.querySelector('[data-label]').value.trim();
      if (!label) return toast(t('名称不能为空'), 'err');
      const id = `t_${uid('x').slice(2, 8)}`;
      store.commit((w) => w.types.push({ id, label: label.slice(0, 12), color, glyph }));
      m.close();
      state.types.clear();
      state.types.add(id);
      render();
      toast(`${t('已创建')}「${label}」`);
    };
    setTimeout(() => m.root.querySelector('[data-label]').focus(), 30);
  }

  function render() {
    const tags = allTags();
    page.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">${esc(t('设定卡库'))}</h1>
          <p class="page-sub">${esc(`${t(`${store.world.entities.length} 张卡`)} · ${t('人物、地点、势力、物品都在这里')}`)}</p>
        </div>
        <span class="spacer"></span>
        <button class="btn" data-import>${esc(t('导入 txt'))}</button>
        <button class="btn" data-relayout>${esc(t('环形重排关系图'))}</button>
        <button class="btn primary" data-new><svg class="ico"><use href="#i-plus" /></svg>${esc(t('新建设定'))}</button>
      </div>

      <div class="toolbar">
        <div class="search-box">
          <svg class="ico"><use href="#i-search" /></svg>
          <input type="search" id="card-search" placeholder="${esc(t('搜索名称、正文、标签…'))}" value="${esc(state.q)}" />
        </div>
        <div class="chips" id="type-chips">
          <button class="chip ${state.types.size === 0 ? 'on' : ''}" data-type="">${esc(t('全部'))}</button>
          ${store
            .allTypes()
            .map((tp) => {
              const n = store.typeCount(tp.id);
              return `<button class="chip ${state.types.has(tp.id) ? 'on' : ''}" data-type="${esc(tp.id)}">
                <i class="type-dot" style="background:${tp.color};display:inline-block;margin-right:5px"></i>${esc(t(tp.label))}${n ? `<span class="muted"> ${n}</span>` : ''}
              </button>`;
            })
            .join('')}
          <button class="chip chip-add" data-add-type title="${esc(t('新类型'))}">＋</button>
        </div>
        <span class="spacer"></span>
        <select id="sort" style="max-width:150px">
          <option value="type" ${state.sort === 'type' ? 'selected' : ''}>${esc(t('按类型'))}</option>
          <option value="name" ${state.sort === 'name' ? 'selected' : ''}>${esc(t('按名称'))}</option>
          <option value="new" ${state.sort === 'new' ? 'selected' : ''}>${esc(t('最近创建'))}</option>
        </select>
      </div>

      ${tags.length ? `<div class="chips" style="margin-bottom:18px">
        <span class="muted small" style="align-self:center;margin-right:4px">${esc(t('标签'))}</span>
        ${tags.map(([tag, n]) => `<button class="chip ${state.tag === tag ? 'on' : ''}" data-tag="${esc(tag)}">${esc(tag)}<span class="muted"> ${n}</span></button>`).join('')}
      </div>` : ''}

      <div class="grid" id="card-grid"></div>
    `;
    renderGrid();

    page.querySelector('[data-new]').onclick = openNewChooser;
    page.querySelector('[data-import]').onclick = () => openImportWizard({ onDone: render });
    page.querySelector('[data-relayout]').onclick = () => {
      const list = store.world.entities;
      const R = Math.min(430, 130 + list.length * 16);
      store.commit((w) => {
        w.entities.forEach((e, i) => {
          const a = (i / Math.max(1, list.length)) * Math.PI * 2 - Math.PI / 2;
          e.graph = { x: Math.round(Math.cos(a) * R), y: Math.round(Math.sin(a) * R * 0.72) };
        });
      });
      toast(t('关系图已重排'));
    };

    const search = page.querySelector('#card-search');
    search.addEventListener(
      'input',
      debounce(() => {
        state.q = search.value.trim();
        renderGrid();
      }, 120)
    );
    page.querySelector('#type-chips').onclick = (e) => {
      if (e.target.closest('[data-add-type]')) return openTypeCreator();
      const btn = e.target.closest('[data-type]');
      if (!btn) return;
      const type = btn.dataset.type;
      if (!type) state.types.clear();
      else if (state.types.has(type)) state.types.delete(type);
      else state.types.add(type);
      render();
      page.querySelector('#card-search')?.focus();
    };
    page.querySelector('#sort').onchange = (e) => {
      state.sort = e.target.value;
      renderGrid();
    };
    page.querySelectorAll('[data-tag]').forEach((btn) => {
      btn.onclick = () => {
        state.tag = state.tag === btn.dataset.tag ? null : btn.dataset.tag;
        render();
      };
    });
  }

  function renderGrid() {
    const grid = page.querySelector('#card-grid');
    if (!grid) return;
    const { list, tokens } = collect();
    let rows = list;

    if (tokens.length) {
      rows = [...rows].sort((a, b) => b.score - a.score);
    } else if (state.sort === 'name') {
      rows = [...rows].sort((a, b) => a.entity.name.localeCompare(b.entity.name, 'zh'));
    } else if (state.sort === 'new') {
      rows = [...rows].sort((a, b) => String(b.entity.createdAt).localeCompare(String(a.entity.createdAt)));
    } else {
      const order = store.allTypes().map((tp) => tp.id);
      rows = [...rows].sort(
        (a, b) =>
          order.indexOf(a.entity.type) - order.indexOf(b.entity.type) || a.entity.name.localeCompare(b.entity.name, 'zh')
      );
    }

    const countLine = tokens.length
      ? `<div class="muted small" style="margin:-6px 0 14px">${esc(t(`${rows.length} 条结果`))} · <span class="mono">${esc(state.q)}</span></div>`
      : '';

    if (!rows.length) {
      grid.innerHTML = `${countLine}<div class="empty" style="grid-column:1/-1">
        <strong>${esc(store.world.entities.length ? t('没有匹配的设定') : t('这个世界的设定还是空的'))}</strong>
        ${esc(store.world.entities.length ? t('换个关键词，或者清掉筛选。') : t('从一个人物、一座城，或者一件道具开始。'))}
      </div>`;
      return;
    }

    grid.innerHTML =
      countLine +
      rows
        .map(({ entity }) => {
          const meta = store.typeMeta(entity.type);
          const relCount = store.relationsOf(entity.id).length;
          const cover = entity.images[0] ? `/images/${encodeURIComponent(entity.images[0])}` : '';
          return `<article class="card" data-id="${entity.id}">
          ${cover ? `<img class="card-thumb" src="${cover}" alt="" loading="lazy" />` : ''}
          <div class="card-top">
            <span class="type-dot" style="background:${meta.color}"></span>
            <span class="muted small">${esc(t(meta.label))}</span>
          </div>
          <div class="card-name">${highlight(entity.name, tokens)}</div>
          <div class="card-sum">${highlight(entity.summary || entity.body.slice(0, 80) || t('还没写'), tokens)}</div>
          <div class="card-meta">
            ${entity.tags.slice(0, 3).map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}
            ${relCount ? `<span class="muted" style="margin-left:auto">${esc(t(`${relCount} 条关系`))}</span>` : ''}
          </div>
        </article>`;
        })
        .join('');

    grid.onclick = (e) => {
      const card = e.target.closest('[data-id]');
      if (card) openEntityEditor(card.dataset.id);
    };
  }

  function openNewChooser() {
    const m = openModal({
      title: t('新建条目'),
      narrow: true,
      body: `<div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">
        ${store
          .allTypes()
          .map(
            (tp) => `<button class="card" data-new-type="${esc(tp.id)}" style="align-items:flex-start;min-height:96px">
              <span class="type-dot" style="background:${tp.color}"></span>
              <div class="card-name" style="font-size:15px">${esc(t(tp.label))}</div>
              <div class="card-sum">${esc(
                t(
                  {
                    character: '有欲望、有秘密的人',
                    location: '一座城、房间、野外',
                    faction: '组织、教团、家族',
                    item: '器物、兵器、遗迹',
                    concept: '体系、规则、风俗、技术'
                  }[tp.id] || ''
                )
              )}</div>
            </button>`
          )
          .join('')}
      </div>`
    });
    m.root.querySelectorAll('[data-new-type]').forEach((btn) => {
      btn.onclick = () => {
        m.close();
        openEntityEditor(null, { presetType: btn.dataset.newType });
      };
    });
  }

  render();
  return { refresh: render };
}
