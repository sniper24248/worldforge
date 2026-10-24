/** 时间线：按年代排布事件，可直接拖动改年份 */

import { store, uid } from '../store.js';
import { esc, openModal, confirmDialog, toast, promptDialog } from '../ui.js';
import { openEntityPreview } from './entity-editor.js';

const state = { selected: null, hiddenThreads: new Set() };

const CHIP_W = 176;
const ROW_H = 64;

function niceStep(span) {
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]) {
    if (span / s <= 14) return s;
  }
  return 1000;
}

export function mount(root, ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'tl-wrap';
  root.appendChild(wrap);

  const bar = document.createElement('div');
  bar.className = 'map-toolbar';
  root.appendChild(bar);

  let dragging = null;

  function render() {
    const events = store.world.events;
    bar.innerHTML = `
      <button class="map-tool" data-tool="new">＋ 新事件</button>
      <span style="width:1px;background:var(--line);margin:0 4px"></span>
      <span class="status-line" style="padding:0 8px">${esc(t(`${events.length} 个事件`))} · ${esc(t('拖动卡片可改年份'))}</span>
    `;
    bar.querySelector('[data-tool="new"]').onclick = () => newEvent(null);

    if (!events.length) {
      wrap.innerHTML = `<div class="empty" style="margin-top:40px"><strong>时间线是空的</strong>加第一个事件：谁、哪一年、发生了什么。</div>`;
      return;
    }

    const years = events.map((e) => e.year);
    let min = Math.min(...years);
    let max = Math.max(...years);
    if (min === max) {
      min -= 2;
      max += 2;
    }
    const pad = Math.max(1, Math.round((max - min) * 0.06));
    min -= pad;
    max += pad;
    const span = max - min;

    const threads = [...new Set(events.map((e) => e.thread))];
    for (const t of [...state.hiddenThreads]) if (!threads.includes(t)) state.hiddenThreads.delete(t);
    const visibleThreads = threads.filter((t) => !state.hiddenThreads.has(t));

    const available = Math.max(600, wrap.clientWidth - 140);
    const laneW = available;
    // 事件卡有自己的宽度，年份要映射到「能放下整张卡」的轨道里，否则最右边会被切掉
    const innerW = Math.max(220, laneW - CHIP_W);

    const step = niceStep(span);
    const ticks = [];
    for (let y = Math.ceil(min / step) * step; y <= max; y += step) ticks.push(y);

    const xOf = (year) => ((year - min) / span) * innerW;

    // 每个事件分到一条不重叠的行
    const layoutFor = (list) => {
      const sorted = [...list].sort((a, b) => a.year - b.year);
      const rows = [];
      const placed = [];
      for (const ev of sorted) {
        const x = xOf(ev.year);
        let row = 0;
        for (; row < rows.length; row++) {
          if (!rows[row].some((p) => Math.abs(p - x) < CHIP_W - 8)) break;
        }
        if (!rows[row]) rows[row] = [];
        rows[row].push(x);
        placed.push({ ev, x, row });
      }
      return { placed, rows: rows.length };
    };

    const lanes = visibleThreads.map((t) => {
      const list = events.filter((e) => e.thread === t);
      const { placed, rows } = layoutFor(list);
      const height = Math.max(1, rows) * ROW_H + 26;
      return { thread: t, placed, height, count: list.length };
    });

    wrap.innerHTML = `
      <div class="tl-canvas" style="width:${laneW + 132}px">
        <div class="tl-lane" style="height:34px;border-bottom:1px solid var(--line);background:none">
          <div class="tl-lane-name" style="top:8px">年代</div>
          <div class="tl-axis" style="position:absolute;left:0;right:0;top:0;height:34px;border:0;margin:0">
            ${ticks.map((y) => `<span class="tl-tick" style="left:${xOf(y)}px">${y < 0 ? `前${-y}` : y}${Math.round(span) > 40 ? '' : ' 年'}</span>`).join('')}
          </div>
        </div>
        ${lanes
          .map(
            (lane) => `<div class="tl-lane" data-thread="${esc(lane.thread)}" style="height:${lane.height}px">
              <div class="tl-lane-name">
                <div>${esc(lane.thread)}</div>
                <div class="muted" style="font-size:10.5px">${lane.count} 个</div>
              </div>
              ${lane.placed
                .map(
                  ({ ev, x, row }) => `<div class="tl-event ${state.selected === ev.id ? 'sel' : ''}" data-ev="${ev.id}"
                    style="left:${x}px;top:${row * ROW_H + 12}px;width:${CHIP_W}px">
                    <b>${esc(ev.title)}</b>
                    <span>第 ${ev.year} 年${ev.entityIds.length ? ` · ${ev.entityIds.length} 个条目` : ''}</span>
                  </div>`
                )
                .join('')}
            </div>`
          )
          .join('')}
        <div style="height:40px"></div>
      </div>
    `;

    // 点事件 = 编辑；拖动 = 改年份
    wrap.querySelectorAll('[data-ev]').forEach((chip) => {
      chip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const id = chip.dataset.ev;
        const ev = store.world.events.find((x) => x.id === id);
        const startX = e.clientX;
        const startLeft = chip.offsetLeft;
        let moved = false;
        chip.setPointerCapture(e.pointerId);
        chip.classList.add('dragging');
        dragging = { id, ev };

        const move = (me) => {
          const dx = me.clientX - startX;
          if (Math.abs(dx) > 3) moved = true;
          const left = Math.max(0, Math.min(innerW, startLeft + dx));
          chip.style.left = `${left}px`;
          const year = Math.round(min + (left / innerW) * span);
          chip.querySelector('span').textContent = `第 ${year} 年`;
          dragging.year = year;
        };
        const up = () => {
          chip.removeEventListener('pointermove', move);
          chip.removeEventListener('pointerup', up);
          chip.classList.remove('dragging');
          dragging = null;
          if (moved && dragging === null) {
            const year = dragging?.year;
            const finalYear = Number(chip.querySelector('span').textContent.replace(/[^\-\d]/g, ''));
            if (Number.isFinite(finalYear) && finalYear !== ev.year) {
              store.commit((w) => {
                const target = w.events.find((x) => x.id === id);
                if (target) target.year = finalYear;
              });
              return;
            }
            render();
          } else if (!moved) {
            openEventEditor(id);
          }
        };
        chip.addEventListener('pointermove', move);
        chip.addEventListener('pointerup', up);
      });
      chip.addEventListener('dblclick', (e) => e.stopPropagation());
    });

    // 双击空白处 = 在该年份新建
    wrap.querySelectorAll('.tl-lane[data-thread]').forEach((lane) => {
      lane.addEventListener('dblclick', (e) => {
        if (e.target.closest('[data-ev]')) return;
        const rect = lane.getBoundingClientRect();
        const x = Math.max(0, Math.min(innerW, e.clientX - rect.left));
        const year = Math.round(min + (x / innerW) * span);
        newEvent(lane.dataset.thread, year);
      });
    });
  }

  function entityChecklist(selected = []) {
    return store.world.entities
      .map(
        (e) => `<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-dim);padding:3px 0">
          <input type="checkbox" value="${e.id}" ${selected.includes(e.id) ? 'checked' : ''} />
          ${esc(e.name)}<span class="muted" style="font-size:10.5px">${store.typeMeta(e.type).label}</span>
        </label>`
      )
      .join('');
  }

  function openEventEditor(id) {
    const ev = id ? store.world.events.find((e) => e.id === id) : null;
    const draft = ev ? { ...ev } : { id: uid('ev'), title: '', year: 0, thread: '主线', summary: '', entityIds: [] };
    const threads = [...new Set(store.world.events.map((e) => e.thread))];
    const m = openModal({
      title: ev ? '编辑事件' : '新事件',
      body: `
        <div class="form-grid">
          <div class="field"><label>标题</label><input type="text" data-title value="${esc(draft.title)}" /></div>
          <div class="field"><label>年份（公元前用负数）</label><input type="number" data-year value="${draft.year}" /></div>
          <div class="field"><label>线索</label>
            <input type="text" data-thread value="${esc(draft.thread)}" list="thread-list" />
            <datalist id="thread-list">${threads.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
          </div>
          <div class="field"><label>关联条目</label><div style="max-height:132px;overflow:auto">${entityChecklist(draft.entityIds)}</div></div>
          <div class="field full"><label>摘要</label><textarea data-summary rows="3">${esc(draft.summary)}</textarea></div>
        </div>`,
      footer: `${ev ? '<button class="btn danger" data-del>删除</button>' : ''}<span class="spacer"></span>
        <button class="btn" data-cancel>取消</button><button class="btn primary" data-ok>保存</button>`
    });
    m.root.querySelector('[data-cancel]').onclick = () => m.close();
    m.root.querySelector('[data-ok]').onclick = () => {
      const title = m.root.querySelector('[data-title]').value.trim();
      if (!title) return toast('标题不能为空', 'err');
      const payload = {
        id: draft.id,
        title,
        year: Number(m.root.querySelector('[data-year]').value) || 0,
        thread: m.root.querySelector('[data-thread]').value.trim() || '主线',
        summary: m.root.querySelector('[data-summary]').value.trim(),
        entityIds: [...m.root.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value)
      };
      store.commit((w) => {
        const idx = w.events.findIndex((e) => e.id === payload.id);
        if (idx >= 0) w.events[idx] = payload;
        else w.events.push(payload);
      });
      m.close();
      toast(ev ? '事件已保存' : '事件已添加');
    };
    m.root.querySelector('[data-del]')?.addEventListener('click', () => {
      m.close();
      store.commit((w) => (w.events = w.events.filter((e) => e.id !== draft.id)));
      toast('事件已删除');
    });
  }

  function newEvent(thread, year) {
    const draft = {
      id: uid('ev'),
      title: '',
      year: year ?? (store.world.events.length ? Math.max(...store.world.events.map((e) => e.year)) + 1 : 0),
      thread: thread || '主线',
      summary: '',
      entityIds: []
    };
    const threads = [...new Set(store.world.events.map((e) => e.thread))];
    const m = openModal({
      title: '新事件',
      body: `
        <div class="form-grid">
          <div class="field"><label>标题</label><input type="text" data-title placeholder="比如：第三次涨潮" autofocus /></div>
          <div class="field"><label>年份</label><input type="number" data-year value="${draft.year}" /></div>
          <div class="field"><label>线索</label><input type="text" data-thread value="${esc(draft.thread)}" list="tl2" />
            <datalist id="tl2">${threads.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></div>
          <div class="field"><label>关联条目</label><div style="max-height:132px;overflow:auto">${entityChecklist(draft.entityIds)}</div></div>
          <div class="field full"><label>摘要</label><textarea data-summary rows="3"></textarea></div>
        </div>`,
      footer: `<span class="spacer"></span><button class="btn" data-cancel>取消</button><button class="btn primary" data-ok>添加</button>`
    });
    setTimeout(() => m.root.querySelector('[data-title]').focus(), 30);
    m.root.querySelector('[data-cancel]').onclick = () => m.close();
    m.root.querySelector('[data-ok]').onclick = () => {
      const title = m.root.querySelector('[data-title]').value.trim();
      if (!title) return toast('标题不能为空', 'err');
      store.commit((w) =>
        w.events.push({
          id: draft.id,
          title,
          year: Number(m.root.querySelector('[data-year]').value) || 0,
          thread: m.root.querySelector('[data-thread]').value.trim() || '主线',
          summary: m.root.querySelector('[data-summary]').value.trim(),
          entityIds: [...m.root.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value)
        })
      );
      m.close();
      toast('事件已添加');
    };
  }

  render();
  return { refresh: render };
}
