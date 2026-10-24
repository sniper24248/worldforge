/** 地图：程序绘制区域 / 地点 / 路线，生图只当底图皮肤 */

import { store, ROUTE_KINDS, REGION_KINDS, PATH_KINDS, uid } from '../store.js';
import { esc, toast, openModal, confirmDialog, promptDialog, download } from '../ui.js';
import { t } from '../i18n.js';
import { openEntityEditor, openEntityPreview } from './entity-editor.js';

const state = {
  zoom: 1,
  pan: { x: 0, y: 0 },
  tool: 'select',
  regionSubtype: 'land',
  pathSubtype: 'road',
  selected: null, // { kind: 'region'|'pin'|'route', id }
  pending: [],
  cursor: null
};

const W = () => store.world.map.canvas.w || 1600;
const H = () => store.world.map.canvas.h || 1000;

export function mount(root, ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'canvas-wrap';
  root.appendChild(wrap);

  const bar = document.createElement('div');
  bar.className = 'map-toolbar';
  root.appendChild(bar);

  const zoomBox = document.createElement('div');
  zoomBox.className = 'map-zoom';
  zoomBox.innerHTML = `<button data-zoom="in">＋</button><button data-zoom="out">－</button><button data-zoom="reset">⌖</button>`;
  root.appendChild(zoomBox);

  const hint = document.createElement('div');
  hint.className = 'map-hint';
  root.appendChild(hint);

  // 底部要素类型选择栏
  const palette = document.createElement('div');
  palette.className = 'map-palette';
  root.appendChild(palette);

  // 左下角自动图例
  const legend = document.createElement('div');
  legend.className = 'map-legend';
  root.appendChild(legend);

  const dock = document.getElementById('dock');

  let stroke = null; // { kind, pts, el }
  let drag = null;

  const svgPoint = (svg, ev) => {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: (p.x - state.pan.x) / state.zoom, y: (p.y - state.pan.y) / state.zoom };
  };
  const vbPoint = (svg, ev) => {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };

  function centroid(points) {
    if (!points.length) return { x: 0, y: 0 };
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      const f = x1 * y2 - x2 * y1;
      a += f;
      cx += (x1 + x2) * f;
      cy += (y1 + y2) * f;
    }
    if (Math.abs(a) < 1e-6) {
      const s = points.reduce((acc, p) => ({ x: acc.x + p[0], y: acc.y + p[1] }), { x: 0, y: 0 });
      return { x: s.x / points.length, y: s.y / points.length };
    }
    a *= 0.5;
    return { x: cx / (6 * a), y: cy / (6 * a) };
  }

  function render() {
    const map = store.world.map;
    const selected = state.selected;
    bar.innerHTML = `
      <button class="map-tool ${state.tool === 'select' ? 'on' : ''}" data-tool="select">${esc(t('选择'))}</button>
      <button class="map-tool ${state.tool === 'region' ? 'on' : ''}" data-tool="region">${esc(t('区域'))}</button>
      <button class="map-tool ${state.tool === 'pin' ? 'on' : ''}" data-tool="pin">${esc(t('地点'))}</button>
      <button class="map-tool ${state.tool === 'route' ? 'on' : ''}" data-tool="route">${esc(t('路径'))}</button>
      <button class="map-tool ${state.tool === 'erase' ? 'on' : ''}" data-tool="erase">${esc(t('擦除'))}</button>
      <span style="width:1px;background:var(--line);margin:0 4px"></span>
      <button class="map-tool" data-act="bg">${esc(t('底图'))}</button>
      <button class="map-tool" data-act="export">${esc(t('导出 SVG'))}</button>
    `;
    hint.textContent =
      state.tool === 'region'
        ? `${t(REGION_KINDS[state.regionSubtype].label)}：${t('点击落点，双击或回车闭合；Esc 取消')}`
        : state.tool === 'route'
          ? `${t(PATH_KINDS[state.pathSubtype].label)}：${t('点击连线，双击或回车结束；Esc 取消')}`
          : state.tool === 'pin'
            ? t('点击放一个地点')
            : state.tool === 'erase'
              ? t('点中要删除的区域 / 地点 / 道路')
              : t('拖动平移 · 滚轮缩放 · 双击编辑');

    // 底部类型选择栏：选了类型，画法自动跟着切
    palette.innerHTML = `
      <div class="mp-group">
        <span class="mp-title">${esc(t('区域'))}</span>
        ${Object.entries(REGION_KINDS)
          .map(
            ([k, v]) =>
              `<button class="mp-chip ${state.tool === 'region' && state.regionSubtype === k ? 'on' : ''}" data-region-kind="${k}">
                 <i class="mp-swatch" style="background:${v.color}"></i>${esc(t(v.label))}
               </button>`
          )
          .join('')}
      </div>
      <span class="mp-sep"></span>
      <div class="mp-group">
        <span class="mp-title">${esc(t('路径'))}</span>
        ${Object.entries(PATH_KINDS)
          .filter(([k]) => k !== 'other')
          .map(
            ([k, v]) =>
              `<button class="mp-chip ${state.tool === 'route' && state.pathSubtype === k ? 'on' : ''}" data-path-kind="${k}">
                 <i class="mp-line" style="border-top-color:${v.color};border-top-style:${v.dash ? 'dashed' : 'solid'}"></i>${esc(t(v.label))}
               </button>`
          )
          .join('')}
      </div>
      <span class="mp-sep"></span>
      <button class="mp-chip ${state.tool === 'pin' ? 'on' : ''}" data-pin-tool>${esc(t('地点'))}</button>
    `;
    palette.querySelectorAll('[data-region-kind]').forEach((btn) => {
      btn.onclick = () => {
        state.regionSubtype = btn.dataset.regionKind;
        state.tool = 'region';
        state.pending = [];
        hideDock();
        render();
      };
    });
    palette.querySelectorAll('[data-path-kind]').forEach((btn) => {
      btn.onclick = () => {
        state.pathSubtype = btn.dataset.pathKind;
        state.tool = 'route';
        state.pending = [];
        hideDock();
        render();
      };
    });
    palette.querySelector('[data-pin-tool]').onclick = () => {
      state.tool = 'pin';
      state.pending = [];
      render();
    };

    // 自动图例：只列实际用到的类型
    const used = new Map();
    for (const r of map.regions) {
      const key = `region:${r.subtype || 'land'}`;
      used.set(key, (used.get(key) || 0) + 1);
    }
    for (const r of map.routes) {
      const key = `path:${r.subtype || 'road'}`;
      used.set(key, (used.get(key) || 0) + 1);
    }
    legend.innerHTML = used.size
      ? `<div class="ml-title">${esc(t('图例'))}</div>${[...used.entries()]
          .map(([key, n]) => {
            const [kind, sub] = key.split(':');
            if (kind === 'region') {
              const rk = REGION_KINDS[sub] || REGION_KINDS.land;
              return `<div class="ml-row"><i class="mp-swatch" style="background:${rk.color}"></i>${esc(t(rk.label))}<span>${n}</span></div>`;
            }
            const pk = PATH_KINDS[sub] || PATH_KINDS.other;
            return `<div class="ml-row"><i class="mp-line" style="border-top-color:${pk.color};border-top-style:${pk.dash ? 'dashed' : 'solid'}"></i>${esc(t(pk.label))}<span>${n}</span></div>`;
          })
          .join('')}`
      : '';
    legend.hidden = !used.size;

    const pins = map.pins
      .map((p) => {
        const ent = p.entityId ? store.entity(p.entityId) : null;
        const color = ent ? store.typeMeta(ent.type).color : '#8f8577';
        const r = p.size === 'city' ? 7 : 5;
        const active = selected?.kind === 'pin' && selected.id === p.id;
        return `<g class="pin" data-pin="${p.id}" transform="translate(${p.x},${p.y})" style="cursor:pointer">
          ${p.size === 'city' ? `<circle r="${r + 5}" fill="none" stroke="${color}" stroke-width="1" opacity=".45"></circle>` : ''}
          <circle r="${r}" fill="${color}" stroke="#0f0d0b" stroke-width="1.6"></circle>
          ${active ? `<circle r="${r + 7}" fill="none" stroke="var(--amber)" stroke-width="1.2" stroke-dasharray="3 3"></circle>` : ''}
          <text class="pin-label" x="10" y="4">${esc(p.label)}</text>
        </g>`;
      })
      .join('');

    const routes = map.routes
      .map((r) => {
        const pk = PATH_KINDS[r.subtype] || PATH_KINDS.other;
        const d = r.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
        const mid = r.points[Math.floor(r.points.length / 2)] || [0, 0];
        const active = selected?.kind === 'route' && selected.id === r.id;
        return `<g class="route-group" data-route="${r.id}" style="cursor:pointer">
          <path d="${d}" stroke="transparent" stroke-width="16" fill="none"></path>
          <path class="route" d="${d}" stroke="${r.color || pk.color}" stroke-width="${active ? pk.width + 1.2 : pk.width}"
                stroke-dasharray="${pk.dash}" opacity="${active ? 1 : 0.85}"></path>
          ${r.label ? `<text class="route-label" x="${mid[0]}" y="${mid[1] - 8}">${esc(r.label)}</text>` : ''}
        </g>`;
      })
      .join('');

    const regions = map.regions
      .map((r) => {
        const rk = REGION_KINDS[r.subtype] || REGION_KINDS.land;
        const fill = r.color || rk.color;
        const d = r.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ') + ' Z';
        const c = r.labelAt ? { x: r.labelAt[0], y: r.labelAt[1] } : centroid(r.points);
        const active = selected?.kind === 'region' && selected.id === r.id;
        return `<g class="region-group" data-region="${r.id}" style="cursor:pointer">
          <path class="region" d="${d}" fill="${fill}" fill-opacity="${rk.fillOpacity}" stroke="${fill}" stroke-width="${active ? 2.6 : 1.6}"></path>
          <text class="region-label" x="${c.x}" y="${c.y}">${esc(r.name)}</text>
        </g>`;
      })
      .join('');

    const selRegion = selected?.kind === 'region' ? map.regions.find((r) => r.id === selected.id) : null;
    const handles = selRegion
      ? selRegion.points
          .map(
            ([x, y], i) => `<circle class="vertex" data-vertex="${i}" cx="${x}" cy="${y}" r="5.5" vector-effect="non-scaling-stroke"></circle>`
          )
          .join('')
      : '';

    wrap.innerHTML = `
      <svg id="map-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W()} ${H()}" preserveAspectRatio="xMidYMid meet"
           style="cursor:${state.tool === 'select' ? 'grab' : 'crosshair'}">
        <defs>
          <pattern id="map-grid" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M80 0H0V80" fill="none" stroke="rgba(255,255,255,.035)" stroke-width="1"></path>
          </pattern>
          <filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" result="n"/>
            <feColorMatrix in="n" type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.05"/></feComponentTransfer></filter>
        </defs>
        <rect width="100%" height="100%" class="map-bg"></rect>
        <g id="map-viewport" transform="translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})">
          <rect width="${W()}" height="${H()}" fill="url(#map-grid)"></rect>
          ${map.bg ? `<image href="/images/${encodeURIComponent(map.bg)}" x="0" y="0" width="${W()}" height="${H()}" preserveAspectRatio="xMidYMid slice" opacity="${map.bgOpacity}"></image>` : ''}
          ${regions}
          ${routes}
          ${pins}
          ${handles}
          <g id="draft-layer"></g>
          <polyline id="draft-preview" fill="none" stroke="var(--amber)" stroke-width="2" stroke-dasharray="6 4" opacity=".9"></polyline>
        </g>
      </svg>
    `;

    const svg = wrap.querySelector('#map-svg');

    bar.querySelectorAll('[data-tool]').forEach((b) => {
      b.onclick = () => {
        state.tool = b.dataset.tool;
        state.pending = [];
        hideDock();
        render();
      };
    });
    bar.querySelector('[data-act="bg"]').onclick = openBgDialog;
    bar.querySelector('[data-act="export"]').onclick = () => exportSvg(svg);

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = svgPoint(svg, e);
      const factor = Math.exp(-e.deltaY * 0.0015);
      const z = Math.min(6, Math.max(0.35, state.zoom * factor));
      const vb = vbPoint(svg, e);
      state.pan.x = vb.x - before.x * z;
      state.pan.y = vb.y - before.y * z;
      state.zoom = z;
      const vp = wrap.querySelector('#map-viewport');
      vp.setAttribute('transform', `translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})`);
    }, { passive: false });

    svg.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.pin') || ev.target.closest('.region-group') || ev.target.closest('.route-group') || ev.target.closest('.vertex')) return;
      if (state.tool === 'select') {
        drag = { kind: 'pan', vb0: vbPoint(svg, ev), pan: { ...state.pan }, moved: false };
        svg.setPointerCapture(ev.pointerId);
        svg.style.cursor = 'grabbing';
      }
    });

    svg.addEventListener('pointermove', (ev) => {
      const p = svgPoint(svg, ev);
      if (drag?.kind === 'pan') {
        const vb = vbPoint(svg, ev);
        if (Math.abs(vb.x - drag.vb0.x) + Math.abs(vb.y - drag.vb0.y) > 2) drag.moved = true;
        state.pan.x = drag.pan.x + (vb.x - drag.vb0.x) / state.zoom;
        state.pan.y = drag.pan.y + (vb.y - drag.vb0.y) / state.zoom;
        wrap.querySelector('#map-viewport')?.setAttribute('transform', `translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})`);
        return;
      }
      if (state.pending.length) {
        const preview = wrap.querySelector('#draft-preview');
        if (preview) {
          const pts = [...state.pending, [p.x, p.y]].map((q) => `${q[0]},${q[1]}`).join(' ');
          preview.setAttribute('points', pts);
        }
      }
    });

    svg.addEventListener('pointerup', () => {
      if (drag?.kind === 'pan') {
        if (!drag.moved) {
          state.selected = null;
          hideDock();
          render();
        }
        drag = null;
        svg.style.cursor = state.tool === 'select' ? 'grab' : 'crosshair';
      }
    });

    const cancelPending = () => {
      state.pending = [];
      render();
    };

    svg.addEventListener('click', (ev) => {
      if (drag?.kind === 'pan' && drag.moved) return;
      const p = svgPoint(svg, ev);

      if (state.tool === 'region') {
        state.pending.push([Math.round(p.x), Math.round(p.y)]);
        drawPending(svg);
        return;
      }
      if (state.tool === 'route') {
        state.pending.push([Math.round(p.x), Math.round(p.y)]);
        drawPending(svg);
        return;
      }
      if (state.tool === 'pin') {
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        createPin(x, y);
        return;
      }
      if (state.tool === 'erase') {
        const el = ev.target.closest('[data-region],[data-pin],[data-route]');
        if (!el) return;
        const kind = el.hasAttribute('data-region') ? 'region' : el.hasAttribute('data-pin') ? 'pin' : 'route';
        const id = el.dataset.region || el.dataset.pin || el.dataset.route;
        deleteShape(kind, id);
        return;
      }
    });

    svg.addEventListener('dblclick', (ev) => {
      if (state.tool === 'region' && state.pending.length >= 3) {
        finishRegion();
        return;
      }
      if (state.tool === 'route' && state.pending.length >= 2) {
        finishRoute();
        return;
      }
      const reg = ev.target.closest('[data-region]');
      const pin = ev.target.closest('[data-pin]');
      if (reg) {
        const r = store.world.map.regions.find((x) => x.id === reg.dataset.region);
        if (r) state.selected = { kind: 'region', id: r.id }, render(), openDock();
      } else if (pin) {
        const p = store.world.map.pins.find((x) => x.id === pin.dataset.pin);
        if (p?.entityId) openEntityPreview(p.entityId);
        else if (p) (state.selected = { kind: 'pin', id: p.id }), render(), openDock();
      }
    });

    // 选中
    wrap.querySelectorAll('.region-group, .pin, .route-group').forEach((node) => {
      node.addEventListener('click', (ev) => {
        if (state.tool !== 'select') return;
        ev.stopPropagation();
        const kind = node.classList.contains('pin') ? 'pin' : node.classList.contains('region-group') ? 'region' : 'route';
        const id = node.dataset.pin || node.dataset.region || node.dataset.route;
        state.selected = { kind, id };
        render();
        openDock();
      });
    });

    // 拖动地点
    wrap.querySelectorAll('.pin').forEach((node) => {
      node.addEventListener('pointerdown', (ev) => {
        if (state.tool !== 'select') return;
        ev.stopPropagation();
        const id = node.dataset.pin;
        const pin = store.world.map.pins.find((p) => p.id === id);
        if (!pin) return;
        const start = svgPoint(svg, ev);
        const orig = { x: pin.x, y: pin.y };
        let moved = false;
        svg.setPointerCapture(ev.pointerId);
        const move = (me) => {
          const p = svgPoint(svg, me);
          const dx = p.x - start.x;
          const dy = p.y - start.y;
          if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
          node.setAttribute('transform', `translate(${orig.x + dx},${orig.y + dy})`);
          pin._drag = { x: Math.round(orig.x + dx), y: Math.round(orig.y + dy) };
        };
        const up = () => {
          svg.removeEventListener('pointermove', move);
          svg.removeEventListener('pointerup', up);
          if (moved && pin._drag) {
            const pos = pin._drag;
            delete pin._drag;
            store.commit((w) => {
              const target = w.map.pins.find((p) => p.id === id);
              if (target) Object.assign(target, pos);
            });
          } else {
            delete pin._drag;
            state.selected = { kind: 'pin', id };
            render();
            openDock();
          }
        };
        svg.addEventListener('pointermove', move);
        svg.addEventListener('pointerup', up);
      });
    });

    // 拖动顶点
    wrap.querySelectorAll('.vertex').forEach((node) => {
      node.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        if (!selRegion) return;
        const index = Number(node.dataset.vertex);
        const region = store.world.map.regions.find((r) => r.id === selRegion.id);
        const group = wrap.querySelector(`[data-region="${region.id}"] .region`);
        const pts = region.points.map((p) => [...p]);
        const start = svgPoint(svg, ev);
        let moved = false;
        svg.setPointerCapture(ev.pointerId);
        const move = (me) => {
          const p = svgPoint(svg, me);
          if (Math.hypot(p.x - start.x, p.y - start.y) > 2) moved = true;
          pts[index] = [Math.round(p.x), Math.round(p.y)];
          const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0]},${q[1]}`).join(' ') + ' Z';
          group?.setAttribute('d', d);
          node.setAttribute('cx', pts[index][0]);
          node.setAttribute('cy', pts[index][1]);
        };
        const up = () => {
          svg.removeEventListener('pointermove', move);
          svg.removeEventListener('pointerup', up);
          if (moved) {
            store.commit((w) => {
              const target = w.map.regions.find((r) => r.id === region.id);
              if (target) target.points = pts;
            });
          }
        };
        svg.addEventListener('pointermove', move);
        svg.addEventListener('pointerup', up);
      });
    });

    // 拖动整个区域
    wrap.querySelectorAll('[data-region]').forEach((node) => {
      node.addEventListener('pointerdown', (ev) => {
        if (state.tool !== 'select' || !selRegion || node.dataset.region !== selRegion.id || ev.target.classList.contains('vertex')) return;
        ev.stopPropagation();
        const region = store.world.map.regions.find((r) => r.id === selRegion.id);
        const pts = region.points.map((p) => [...p]);
        const path = node.querySelector('.region');
        const label = wrap.querySelector(`[data-region="${region.id}"] .region-label`);
        const start = svgPoint(svg, ev);
        let moved = false;
        svg.setPointerCapture(ev.pointerId);
        const move = (me) => {
          const p = svgPoint(svg, me);
          const dx = Math.round(p.x - start.x);
          const dy = Math.round(p.y - start.y);
          if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
          const moved_pts = pts.map(([x, y]) => [x + dx, y + dy]);
          path.setAttribute('d', moved_pts.map((q, i) => `${i ? 'L' : 'M'}${q[0]},${q[1]}`).join(' ') + ' Z');
          const c = region.labelAt ? { x: region.labelAt[0] + dx, y: region.labelAt[1] + dy } : centroid(moved_pts);
          label?.setAttribute('x', c.x);
          label?.setAttribute('y', c.y);
          region._drag = { pts: moved_pts, label: region.labelAt ? [c.x, c.y] : null };
        };
        const up = () => {
          svg.removeEventListener('pointermove', move);
          svg.removeEventListener('pointerup', up);
          if (moved && region._drag) {
            const next = region._drag;
            delete region._drag;
            store.commit((w) => {
              const target = w.map.regions.find((r) => r.id === region.id);
              if (!target) return;
              target.points = next.pts;
              if (next.label) target.labelAt = next.label.map((v) => Math.round(v));
            });
          }
        };
        svg.addEventListener('pointermove', move);
        svg.addEventListener('pointerup', up);
      });
    });

    // 绘制中的键盘收尾
    if (state.pending.length) drawPending(svg);
  }

  function drawPending(svg) {
    const layer = wrap.querySelector('#draft-layer');
    if (!layer) return;
    const pts = state.pending.map((p) => `${p[0]},${p[1]}`).join(' ');
    const isRegion = state.tool === 'region';
    layer.innerHTML = `
      <polyline points="${pts}" fill="${isRegion ? 'rgba(216,166,87,.12)' : 'none'}" stroke="var(--amber)" stroke-width="1.8" stroke-dasharray="5 4"></polyline>
      ${state.pending
        .map(
          ([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 0 ? 6 : 4}" fill="#0f0d0b" stroke="var(--amber)" stroke-width="1.6"></circle>`
        )
        .join('')}
    `;
  }

  /** 同类型已有几个，用来生成「公路 2」这种默认名 */
  function nextName(kind, preset) {
    const list = kind === 'region' ? store.world.map.regions : store.world.map.routes;
    const sub = kind === 'region' ? state.regionSubtype : state.pathSubtype;
    const n = list.filter((x) => (x.subtype || (kind === 'region' ? 'land' : 'road')) === sub).length + 1;
    return `${preset.name} ${n}`;
  }

  function finishRegion() {
    if (state.pending.length < 3) return toast(t('至少三个点才能围成区域'), 'err');
    const id = uid('rg');
    const points = [...state.pending];
    const preset = REGION_KINDS[state.regionSubtype] || REGION_KINDS.land;
    const name = nextName('region', preset);
    const subtype = REGION_KINDS[state.regionSubtype] ? state.regionSubtype : 'land';
    state.pending = [];
    store.commit((w) => w.map.regions.push({ id, name, subtype, color: preset.color, points }));
    state.selected = { kind: 'region', id };
    state.tool = 'select';
    render();
    openDock();
    toast(t('区域已创建，右下角可以改名和配色'));
  }

  function finishRoute() {
    if (state.pending.length < 2) return toast(t('至少两个点才能成线'), 'err');
    const id = uid('rt');
    const points = [...state.pending];
    const preset = PATH_KINDS[state.pathSubtype] || PATH_KINDS.road;
    const subtype = PATH_KINDS[state.pathSubtype] ? state.pathSubtype : 'road';
    const name = nextName('route', preset);
    state.pending = [];
    store.commit((w) => w.map.routes.push({ id, label: name, kind: 'other', subtype, points }));
    state.selected = { kind: 'route', id };
    state.tool = 'select';
    render();
    openDock();
  }

  function createPin(x, y) {
    const options = store.world.entities
      .map((e) => `<option value="${e.id}">${esc(e.name)}（${store.typeMeta(e.type).label}）</option>`)
      .join('');
    const m = openModal({
      title: '放置地点',
      narrow: true,
      body: `<div class="field"><label>名称</label><input type="text" data-label placeholder="比如：空湾" /></div>
        <div class="field" style="margin-top:12px"><label>关联设定卡（可选）</label>
          <select data-ent><option value="">不关联</option>${options}</select></div>
        <div class="field" style="margin-top:12px"><label>规模</label>
          <select data-size><option value="site">据点</option><option value="city">城市</option><option value="ruin">遗迹</option></select></div>`,
      footer: `<span class="spacer"></span><button class="btn" data-cancel>取消</button><button class="btn primary" data-ok>放置</button>`
    });
    m.root.querySelector('[data-cancel]').onclick = () => m.close();
    m.root.querySelector('[data-ok]').onclick = () => {
      const entId = m.root.querySelector('[data-ent]').value;
      const ent = entId ? store.entity(entId) : null;
      const label = m.root.querySelector('[data-label]').value.trim() || ent?.name || '新地点';
      const size = m.root.querySelector('[data-size]').value;
      const id = uid('pin');
      store.commit((w) => w.map.pins.push({ id, label, entityId: entId || null, x, y, size }));
      m.close();
      state.tool = 'select';
      state.selected = { kind: 'pin', id };
      render();
      openDock();
    };
    m.root.querySelector('[data-label]').focus();
  }

  async function deleteShape(kind, id) {
    const map = store.world.map;
    const name =
      kind === 'region' ? map.regions.find((r) => r.id === id)?.name : kind === 'pin' ? map.pins.find((p) => p.id === id)?.label : map.routes.find((r) => r.id === id)?.label;
    const ok = await confirmDialog({ title: '删除', message: `删掉「${name || '这个对象'}」？`, confirmText: '删除', danger: true });
    if (!ok) return;
    store.commit((w) => {
      if (kind === 'region') w.map.regions = w.map.regions.filter((r) => r.id !== id);
      if (kind === 'pin') w.map.pins = w.map.pins.filter((p) => p.id !== id);
      if (kind === 'route') w.map.routes = w.map.routes.filter((r) => r.id !== id);
    });
    state.selected = null;
    hideDock();
    toast('已删除');
  }

  function openDock() {
    const map = store.world.map;
    const sel = state.selected;
    if (!sel || state.tool !== 'select') return;
    if (sel.kind === 'region') {
      const r = map.regions.find((x) => x.id === sel.id);
      if (!r) return;
      dock.hidden = false;
      dock.innerHTML = `
        <h3>${esc(t(REGION_KINDS[r.subtype]?.label || '区域'))}</h3>
        <div class="field"><label>${esc(t('类型'))}</label>
          <select data-subtype>${Object.entries(REGION_KINDS)
            .map(([k, v]) => `<option value="${k}" ${k === (r.subtype || 'land') ? 'selected' : ''}>${esc(t(v.label))}</option>`)
            .join('')}</select></div>
        <div class="field" style="margin-top:12px"><label>${esc(t('名称'))}</label><input type="text" data-name value="${esc(r.name)}" /></div>
        <div class="row" style="margin-top:12px">
          <div class="field"><label>${esc(t('颜色'))}</label><input type="color" data-color value="${esc(r.color)}" style="height:36px;padding:2px" /></div>
          <div class="field"><label>${esc(t('顶点'))}</label><div class="mono" style="padding:8px 0">${r.points.length} ${esc(t('个'))}</div></div>
        </div>
        <div class="hr"></div>
        <button class="btn danger small" data-del>${esc(t('删除区域'))}</button>
        <button class="btn ghost small" data-close style="margin-left:6px">${esc(t('收起'))}</button>
      `;
      dock.querySelector('[data-subtype]').onchange = (e) => {
        const preset = REGION_KINDS[e.target.value] || REGION_KINDS.land;
        store.commit((w) => {
          const t2 = w.map.regions.find((x) => x.id === r.id);
          if (!t2) return;
          t2.subtype = e.target.value;
          t2.color = preset.color;
        });
        openDock();
      };
      dock.querySelector('[data-name]').onchange = (e) => {
        store.commit((w) => {
          const t = w.map.regions.find((x) => x.id === r.id);
          if (t) t.name = e.target.value.trim() || '区域';
        });
        openDock();
      };
      dock.querySelector('[data-color]').onchange = (e) => {
        store.commit((w) => {
          const t = w.map.regions.find((x) => x.id === r.id);
          if (t) t.color = e.target.value;
        });
        openDock();
      };
      dock.querySelector('[data-del]').onclick = () => deleteShape('region', r.id);
      dock.querySelector('[data-close]').onclick = () => {
        state.selected = null;
        hideDock();
        render();
      };
    } else if (sel.kind === 'pin') {
      const p = map.pins.find((x) => x.id === sel.id);
      if (!p) return;
      const ents = store.world.entities
        .map((e) => `<option value="${e.id}" ${e.id === p.entityId ? 'selected' : ''}>${esc(e.name)}</option>`)
        .join('');
      dock.hidden = false;
      dock.innerHTML = `
        <h3>地点</h3>
        <div class="field"><label>名称</label><input type="text" data-name value="${esc(p.label)}" /></div>
        <div class="field" style="margin-top:12px"><label>关联设定卡</label>
          <select data-ent><option value="">不关联</option>${ents}</select></div>
        <div class="field" style="margin-top:12px"><label>规模</label>
          <select data-size>
            <option value="site" ${p.size === 'site' ? 'selected' : ''}>据点</option>
            <option value="city" ${p.size === 'city' ? 'selected' : ''}>城市</option>
            <option value="ruin" ${p.size === 'ruin' ? 'selected' : ''}>遗迹</option>
          </select></div>
        <div class="hr"></div>
        ${p.entityId ? '<button class="btn small" data-open>编辑设定卡</button>' : ''}
        <button class="btn danger small" data-del style="margin-left:6px">删除</button>
      `;
      dock.querySelector('[data-name]').onchange = (e) => {
        store.commit((w) => {
          const t = w.map.pins.find((x) => x.id === p.id);
          if (t) t.label = e.target.value.trim() || '地点';
        });
        openDock();
      };
      dock.querySelector('[data-ent]').onchange = (e) => {
        store.commit((w) => {
          const t = w.map.pins.find((x) => x.id === p.id);
          if (t) {
            t.entityId = e.target.value || null;
            const ent = store.entity(t.entityId);
            if (ent && (t.label === '新地点' || !t.label)) t.label = ent.name;
          }
        });
        openDock();
      };
      dock.querySelector('[data-size]').onchange = (e) => {
        store.commit((w) => {
          const t = w.map.pins.find((x) => x.id === p.id);
          if (t) t.size = e.target.value;
        });
        openDock();
      };
      dock.querySelector('[data-open]')?.addEventListener('click', () => openEntityEditor(p.entityId));
      dock.querySelector('[data-del]').onclick = () => deleteShape('pin', p.id);
    } else if (sel.kind === 'route') {
      const r = map.routes.find((x) => x.id === sel.id);
      if (!r) return;
      dock.hidden = false;
      dock.innerHTML = `
        <h3>${esc(t(PATH_KINDS[r.subtype]?.label || '路径'))}</h3>
        <div class="field"><label>名称</label><input type="text" data-name value="${esc(r.label)}" /></div>
        <div class="field" style="margin-top:12px"><label>${esc(t('类型'))}</label>
          <select data-kind>${Object.entries(PATH_KINDS)
            .map(([k, v]) => `<option value="${k}" ${k === (r.subtype || 'road') ? 'selected' : ''}>${esc(t(v.label))}</option>`)
            .join('')}</select></div>
        <div class="mono muted small" style="margin-top:10px">${r.points.length} ${esc(t('个拐点'))}</div>
        <div class="hr"></div>
        <button class="btn danger small" data-del>${esc(t('删除'))}</button>
      `;
      dock.querySelector('[data-name]').onchange = (e) => {
        store.commit((w) => {
          const t = w.map.routes.find((x) => x.id === r.id);
          if (t) t.label = e.target.value.trim();
        });
        openDock();
      };
      dock.querySelector('[data-kind]').onchange = (e) => {
        store.commit((w) => {
          const t2 = w.map.routes.find((x) => x.id === r.id);
          if (t2) t2.subtype = e.target.value;
        });
        openDock();
      };
      dock.querySelector('[data-del]').onclick = () => deleteShape('route', r.id);
    }
  }

  function hideDock() {
    dock.hidden = true;
    dock.innerHTML = '';
  }

  function openBgDialog() {
    const map = store.world.map;
    const shots = store.world.gallery
      .map(
        (g) => `<div class="shot ${map.bg === g.file ? 'selected' : ''}" data-file="${esc(g.file)}">
          <img src="/images/${encodeURIComponent(g.file)}" alt="" />
        </div>`
      )
      .join('');
    const m = openModal({
      title: '地图底图',
      body: `<p class="muted small" style="margin:0">底图只是美术皮肤，地理关系仍然由上面的区域/地点/道路决定。挑一张生图当底色：</p>
        ${shots ? `<div class="gallery" style="margin-top:12px">${shots}</div>` : '<div class="empty" style="margin-top:12px"><strong>图库是空的</strong>先去「生图工坊」生成一张地图底图。</div>'}
        <div class="field" style="margin-top:15px"><label>透明度 <span class="muted" data-opval>${Math.round(map.bgOpacity * 100)}%</span></label>
          <input type="range" min="0" max="1" step="0.05" value="${map.bgOpacity}" data-op /></div>`,
      footer: `<button class="btn" data-none>不用底图</button><span class="spacer"></span><button class="btn primary" data-ok>完成</button>`
    });
    const setBg = (file) => {
      store.commit((w) => (w.map.bg = file));
      render();
    };
    m.root.querySelectorAll('[data-file]').forEach((node) => {
      node.onclick = () => {
        setBg(node.dataset.file);
        m.root.querySelectorAll('.shot').forEach((s) => s.classList.remove('selected'));
        node.classList.add('selected');
      };
    });
    const op = m.root.querySelector('[data-op]');
    op.oninput = () => {
      m.root.querySelector('[data-opval]').textContent = `${Math.round(op.value * 100)}%`;
      store.touch((w) => (w.map.bgOpacity = Number(op.value)));
    };
    m.root.querySelector('[data-none]').onclick = () => {
      setBg(null);
      m.close();
    };
    m.root.querySelector('[data-ok]').onclick = () => m.close();
  }

  async function exportSvg(svg) {
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(W()));
    clone.setAttribute('height', String(H()));
    const img = clone.querySelector('image');
    if (img && store.world.map.bg) {
      try {
        const res = await fetch(`/images/${encodeURIComponent(store.world.map.bg)}`);
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.readAsDataURL(blob);
        });
        img.setAttribute('href', dataUrl);
      } catch {
        /* 拿不到就保持相对路径 */
      }
    }
    const text = new XMLSerializer().serializeToString(clone);
    download(`${store.world.meta.title || 'world'}-map.svg`, text, 'image/svg+xml');
    toast('SVG 已导出');
  }

  const onKey = (e) => {
    if (e.key === 'Escape') {
      if (state.pending.length) {
        state.pending = [];
        render();
      } else if (state.selected) {
        state.selected = null;
        hideDock();
        render();
      }
    }
    if (e.key === 'Enter') {
      if (state.tool === 'region' && state.pending.length >= 3) finishRegion();
      else if (state.tool === 'route' && state.pending.length >= 2) finishRoute();
    }
  };
  document.addEventListener('keydown', onKey);

  zoomBox.onclick = (e) => {
    const btn = e.target.closest('[data-zoom]');
    if (!btn) return;
    const svg = wrap.querySelector('#map-svg');
    if (!svg) return;
    if (btn.dataset.zoom === 'reset') {
      state.zoom = 1;
      state.pan = { x: 0, y: 0 };
      render();
      return;
    }
    const factor = btn.dataset.zoom === 'in' ? 1.25 : 0.8;
    const rect = svg.getBoundingClientRect();
    const vb = { x: W() / 2, y: H() / 2 };
    const before = { x: (vb.x - state.pan.x) / state.zoom, y: (vb.y - state.pan.y) / state.zoom };
    state.zoom = Math.min(6, Math.max(0.35, state.zoom * factor));
    state.pan.x = vb.x - before.x * state.zoom;
    state.pan.y = vb.y - before.y * state.zoom;
    render();
  };

  render();
  return {
    refresh: () => render(),
    destroy: () => {
      document.removeEventListener('keydown', onKey);
      hideDock();
    }
  };
}
