/** 关系图：拖拽排版、连线建关系、缩放平移 */

import { store, TYPES, REL_KINDS, uid } from '../store.js';
import { esc, toast, openModal, confirmDialog } from '../ui.js';
import { openEntityPreview, openEntityEditor } from './entity-editor.js';

const state = {
  zoom: 1,
  pan: { x: 0, y: 0 },
  selected: null,
  linking: null, // 连线模式下已选的起点
  showLabels: false
};

const NODE_R = 34;

export function mount(root, ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'canvas-wrap';
  wrap.style.inset = '0';
  root.appendChild(wrap);

  const bar = document.createElement('div');
  bar.className = 'map-toolbar';
  root.appendChild(bar);

  const legend = document.createElement('div');
  legend.className = 'map-hint';
  legend.style.bottom = '16px';
  legend.style.left = '18px';
  legend.style.transform = 'none';
  root.appendChild(legend);

  let drag = null;

  function render() {
    const w = store.world;
    const nodes = w.entities;
    bar.innerHTML = `
      <button class="map-tool ${state.linking !== null ? 'on' : ''}" data-tool="link">
        <svg class="ico"><use href="#i-graph" /></svg>${state.linking !== null ? '点是目标' : '连线'}
      </button>
      <button class="map-tool" data-tool="layout">整理布局</button>
      <button class="map-tool" data-tool="label">${state.showLabels ? '隐藏说明' : '显示说明'}</button>
      <button class="map-tool" data-tool="fit">复位</button>
      <button class="map-tool" data-tool="new">＋ 新条目</button>
    `;
    legend.innerHTML = Object.entries(REL_KINDS)
      .map(([k, v]) => `<span style="color:${v.color}">—</span> ${v.label}`)
      .join(' &nbsp; ');

    const width = wrap.clientWidth || 900;
    const height = wrap.clientHeight || 600;
    const cx = width / 2;
    const cy = height / 2;

    const edgeColor = (kind) => (REL_KINDS[kind] || {}).color || '#8f8577';
    const pos = (e) => ({ x: cx + state.pan.x + e.graph.x * state.zoom, y: cy + state.pan.y + e.graph.y * state.zoom });

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const neighbors = new Set();
    if (state.selected) {
      neighbors.add(state.selected);
      for (const r of w.relations) {
        if (r.from === state.selected) neighbors.add(r.to);
        if (r.to === state.selected) neighbors.add(r.from);
      }
    }

    const edges = w.relations
      .filter((r) => byId.has(r.from) && byId.has(r.to))
      .map((r, i) => {
        const a = pos(byId.get(r.from));
        const b = pos(byId.get(r.to));
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const r2 = NODE_R * state.zoom;
        const x1 = a.x + ux * r2;
        const y1 = a.y + uy * r2;
        const x2 = b.x - ux * r2;
        const y2 = b.y - uy * r2;
        // 稍微弯一点，双向关系才不会重叠
        const bend = (i % 2 === 0 ? 1 : -1) * Math.min(26, len * 0.09);
        const mx = (x1 + x2) / 2 - uy * bend;
        const my = (y1 + y2) / 2 + ux * bend;
        const active = state.selected && (r.from === state.selected || r.to === state.selected);
        return {
          r,
          d: `M${x1},${y1} Q${mx},${my} ${x2},${y2}`,
          color: edgeColor(r.kind),
          labelX: mx,
          labelY: my - 4,
          active,
          faded: state.selected && !active
        };
      });

    wrap.innerHTML = `
      <svg id="graph-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
          </marker>
        </defs>
        <g id="graph-viewport">
          <g id="edges">
            ${edges
              .map(
                (e) => `<g class="edge-group" data-rel="${e.r.id}">
                  <path class="edge-hit" d="${e.d}"></path>
                  <path class="edge" d="${e.d}" stroke="${e.color}" stroke-width="${e.active ? 2.4 : 1.5}"
                        opacity="${e.faded ? 0.18 : e.active ? 0.95 : 0.55}" marker-end="url(#arrow)"></path>
                  ${(state.showLabels || e.active) && e.r.label ? `<text class="edge-label" x="${e.labelX}" y="${e.labelY}" opacity="${e.faded ? 0.12 : 0.9}">${esc(e.r.label)}</text>` : ''}
                </g>`
              )
              .join('')}
          </g>
          <g id="nodes">
            ${nodes
              .map((e) => {
                const p = pos(e);
                const meta = store.typeMeta(e.type);
                const dim = state.selected && !neighbors.has(e.id);
                return `<g class="gnode ${dim ? 'dim' : ''}" data-node="${e.id}" transform="translate(${p.x},${p.y})">
                  <circle class="node-bg" r="${NODE_R * state.zoom}" stroke="${meta.color}" fill="#1b1713"></circle>
                  <text class="glyph" y="${-2 * state.zoom}" style="font-size:${15 * state.zoom}px">${meta.glyph}</text>
                  <text y="${(NODE_R + 16) * state.zoom}" style="font-size:${13 * state.zoom}px">${esc(e.name)}</text>
                </g>`;
              })
              .join('')}
          </g>
        </g>
      </svg>
    `;

    const svg = wrap.querySelector('#graph-svg');
    const viewport = wrap.querySelector('#graph-viewport');

    const worldFromEvent = (ev) => {
      const rect = svg.getBoundingClientRect();
      return {
        x: (ev.clientX - rect.left - cx - state.pan.x) / state.zoom,
        y: (ev.clientY - rect.top - cy - state.pan.y) / state.zoom
      };
    };

    // 缩放
    svg.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const before = worldFromEvent(ev);
        const factor = Math.exp(-ev.deltaY * 0.0016);
        state.zoom = Math.min(2.4, Math.max(0.28, state.zoom * factor));
        // 以指针为锚点缩放
        const rect = svg.getBoundingClientRect();
        state.pan.x = ev.clientX - rect.left - cx - before.x * state.zoom;
        state.pan.y = ev.clientY - rect.top - cy - before.y * state.zoom;
        render();
      },
      { passive: false }
    );

    // 背景平移 / 取消选择
    svg.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.gnode') || ev.target.closest('.edge-group')) return;
      const start = { x: ev.clientX, y: ev.clientY, pan: { ...state.pan } };
      drag = { kind: 'pan', start, moved: false };
      svg.setPointerCapture(ev.pointerId);
    });

    svg.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      if (drag.kind === 'pan') {
        const dx = ev.clientX - drag.start.x;
        const dy = ev.clientY - drag.start.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        state.pan.x = drag.start.pan.x + dx;
        state.pan.y = drag.start.pan.y + dy;
        viewport.setAttribute('transform', `translate(${state.pan.x},${state.pan.y})`);
      } else if (drag.kind === 'node') {
        const rect = svg.getBoundingClientRect();
        const nx = (ev.clientX - rect.left - cx - state.pan.x) / state.zoom;
        const ny = (ev.clientY - rect.top - cy - state.pan.y) / state.zoom;
        drag.el.setAttribute('transform', `translate(${cx + state.pan.x + nx * state.zoom},${cy + state.pan.y + ny * state.zoom})`);
        drag.pos = { x: nx, y: ny };
        drag.moved = true;
      }
    });

    const endDrag = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.kind === 'node' && d.moved && d.pos) {
        store.commit((w) => {
          const e = w.entities.find((x) => x.id === d.id);
          if (e) e.graph = { x: Math.round(d.pos.x), y: Math.round(d.pos.y) };
        });
      } else if (d.kind === 'pan' && !d.moved) {
        state.selected = null;
        render();
      }
    };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    // 节点交互
    wrap.querySelectorAll('.gnode').forEach((g) => {
      const id = g.dataset.node;
      g.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        if (state.linking !== null) return;
        drag = { kind: 'node', id, el: g, moved: false };
        g.setPointerCapture(ev.pointerId);
      });
      g.addEventListener('pointerup', (ev) => {
        ev.stopPropagation();
        if (state.linking !== null) {
          if (state.linking !== id) openLinkEditor(state.linking, id);
          state.linking = null;
          render();
          return;
        }
        // 单击选中（拖拽过就不算）
        if (!drag?.moved) {
          state.selected = state.selected === id ? null : id;
          render();
        }
      });
      g.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        openEntityPreview(id);
      });
      g.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        openEntityEditor(id);
      });
    });

    wrap.querySelectorAll('.edge-group').forEach((g) => {
      const relId = g.dataset.rel;
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        editRelation(relId);
      });
    });

    bar.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.onclick = () => {
        const t = btn.dataset.tool;
        if (t === 'link') {
          if (state.linking !== null) {
            state.linking = null;
            render();
          } else {
            if (!state.selected) return toast('先点一个节点作为起点');
            state.linking = state.selected;
            render();
            toast('现在点目标节点');
          }
        } else if (t === 'layout') {
          layout();
        } else if (t === 'label') {
          state.showLabels = !state.showLabels;
          render();
        } else if (t === 'fit') {
          state.zoom = 1;
          state.pan = { x: 0, y: 0 };
          state.selected = null;
          render();
        } else if (t === 'new') {
          openEntityEditor(null);
        }
      };
    });
  }

  function openLinkEditor(fromId, toId) {
    const from = store.entity(fromId);
    const to = store.entity(toId);
    if (!from || !to) return;
    const kinds = Object.entries(REL_KINDS)
      .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
      .join('');
    const m = openModal({
      title: '建立关系',
      narrow: true,
      body: `<div class="field"><label>从 → 到</label>
          <div class="mono" style="padding:6px 0">${esc(from.name)} → ${esc(to.name)}</div></div>
        <div class="row">
          <div class="field"><label>类型</label><select data-kind>${kinds}</select></div>
          <div class="field"><label>说明</label><input type="text" data-label placeholder="比如：暗中结盟" /></div>
        </div>`,
      footer: `<span class="spacer"></span><button class="btn" data-cancel>取消</button><button class="btn primary" data-ok>建立</button>`
    });
    m.root.querySelector('[data-cancel]').onclick = () => m.close();
    m.root.querySelector('[data-ok]').onclick = () => {
      const kind = m.root.querySelector('[data-kind]').value;
      const label = m.root.querySelector('[data-label]').value.trim();
      store.commit((w) => w.relations.push({ id: uid('rel'), from: fromId, to: toId, kind, label }));
      m.close();
      toast('关系已建立');
    };
  }

  function editRelation(relId) {
    const rel = store.world.relations.find((r) => r.id === relId);
    if (!rel) return;
    const from = store.entity(rel.from);
    const to = store.entity(rel.to);
    const kinds = Object.entries(REL_KINDS)
      .map(([k, v]) => `<option value="${k}" ${k === rel.kind ? 'selected' : ''}>${v.label}</option>`)
      .join('');
    const m = openModal({
      title: '编辑关系',
      narrow: true,
      body: `<div class="mono" style="margin-bottom:12px">${esc(from?.name || '?')} → ${esc(to?.name || '?')}</div>
        <div class="row">
          <div class="field"><label>类型</label><select data-kind>${kinds}</select></div>
          <div class="field"><label>说明</label><input type="text" data-label value="${esc(rel.label)}" /></div>
        </div>`,
      footer: `<button class="btn danger" data-del>删除</button><span class="spacer"></span>
        <button class="btn" data-cancel>取消</button><button class="btn primary" data-ok>保存</button>`
    });
    m.root.querySelector('[data-cancel]').onclick = () => m.close();
    m.root.querySelector('[data-ok]').onclick = () => {
      const kind = m.root.querySelector('[data-kind]').value;
      const label = m.root.querySelector('[data-label]').value;
      store.commit((w) => {
        const r = w.relations.find((x) => x.id === relId);
        if (r) Object.assign(r, { kind, label });
      });
      m.close();
    };
    m.root.querySelector('[data-del]').onclick = async () => {
      m.close();
      store.commit((w) => (w.relations = w.relations.filter((r) => r.id !== relId)));
      toast('关系已删除');
    };
  }

  function layout() {
    const w = store.world;
    const list = w.entities;
    if (list.length < 2) return toast('至少要有两个条目');
    const edges = w.relations.filter((r) => list.some((e) => e.id === r.from) && list.some((e) => e.id === r.to));
    const pos = new Map(list.map((e, i) => [e.id, { ...e.graph }]));
    const n = list.length;
    const R = 30 + n * 14;

    for (let iter = 0; iter < 260; iter++) {
      const force = new Map(list.map((e) => [e.id, { x: 0, y: 0 }]));
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = pos.get(list[i].id);
          const b = pos.get(list[j].id);
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            d2 = 1;
          }
          const f = (R * R) / d2;
          const d = Math.sqrt(d2);
          force.get(list[i].id).x += (dx / d) * f;
          force.get(list[i].id).y += (dy / d) * f;
          force.get(list[j].id).x -= (dx / d) * f;
          force.get(list[j].id).y -= (dy / d) * f;
        }
      }
      for (const r of edges) {
        const a = pos.get(r.from);
        const b = pos.get(r.to);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const f = (d - R * 1.15) * 0.35;
        force.get(r.from).x += (dx / d) * f;
        force.get(r.from).y += (dy / d) * f;
        force.get(r.to).x -= (dx / d) * f;
        force.get(r.to).y -= (dy / d) * f;
      }
      for (const e of list) {
        const p = pos.get(e.id);
        p.x += Math.max(-24, Math.min(24, force.get(e.id).x));
        p.y += Math.max(-24, Math.min(24, force.get(e.id).y));
      }
    }
    store.commit((world) => {
      for (const e of world.entities) {
        const p = pos.get(e.id);
        if (p) e.graph = { x: Math.round(p.x), y: Math.round(p.y) };
      }
    });
    toast('布局已整理');
  }

  render();
  return { refresh: () => render() };
}
