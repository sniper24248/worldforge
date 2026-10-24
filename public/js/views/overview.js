/** 世界概览：基调、统计、快速入口、AI 审稿 */

import { store, TYPES } from '../store.js';
import { esc, toast, openModal } from '../ui.js';
import { api } from '../api.js';
import { openEntityEditor } from './entity-editor.js';
import { openImportWizard } from './import.js';

function digest() {
  const w = store.world;
  const ents = w.entities
    .map((e) => `- ${e.name}（${store.typeMeta(e.type).label}）：${e.summary}`)
    .join('\n');
  const rels = w.relations
    .map((r) => `- ${store.entity(r.from)?.name || '?'} → ${store.entity(r.to)?.name || '?'}【${r.kind}】${r.label}`)
    .join('\n');
  const evs = w.events.map((ev) => `- 第 ${ev.year} 年 ${ev.title}：${ev.summary}`).join('\n');
  return `世界：${w.meta.title}\n类型：${w.meta.genre}\n一句话：${w.meta.logline}\n基调：${w.meta.tone}\n\n条目：\n${ents}\n\n关系：\n${rels}\n\n事件：\n${evs}`;
}

export function mount(root, ctx) {
  const page = document.createElement('div');
  page.className = 'page';
  root.appendChild(page);

  function render() {
    const w = store.world;
    const counts = Object.keys(TYPES).map((t) => ({ t, n: w.entities.filter((e) => e.type === t).length }));
    const top = [...w.entities]
      .map((e) => ({ e, score: store.relationsOf(e.id).length + store.eventsOf(e.id).length * 2 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    const lastEvents = [...w.events].sort((a, b) => b.year - a.year).slice(0, 5);

    page.innerHTML = `
      <div class="hero">
        <div class="kicker">${esc(w.meta.genre || '世界观设定集')}</div>
        <h1>${esc(w.meta.title || '未命名世界')}</h1>
        <p class="logline">${esc(w.meta.logline || '还没有写一句话梗概。到「设置」里填，或者在设定卡库里先堆素材。')}</p>
        <div class="stats">
          ${counts.map((c) => `<div class="stat"><b>${c.n}</b><span>${store.typeMeta(c.t).plural || store.typeMeta(c.t).label}</span></div>`).join('')}
          <div class="stat"><b>${w.relations.length}</b><span>条关系</span></div>
          <div class="stat"><b>${w.events.length}</b><span>个事件</span></div>
        </div>
      </div>

      <div class="toolbar" style="margin-top:22px">
        <button class="btn primary" data-new>＋ 新设定</button>
        <button class="btn" data-import>导入 txt</button>
        <button class="btn" data-go="graph">看关系图</button>
        <button class="btn" data-go="map">看地图</button>
        <button class="btn" data-go="studio">生一张图</button>
        <span class="spacer"></span>
        <button class="btn" data-critique>AI 审稿</button>
      </div>

      <div class="section-title">世界基调</div>
      <div class="panel" style="display:grid;gap:14px">
        <div class="kv">
          <dt>风格提示词</dt>
          <dd class="mono" style="font-size:12px">${esc(w.meta.worldStyle || '（未填，生图会退化成通用奇幻）')}</dd>
          <dt>基调</dt>
          <dd>${esc(w.meta.tone || '（未填）')}</dd>
          <dt>地图</dt>
          <dd>${w.map.regions.length} 个区域 · ${w.map.pins.length} 个地点 · ${w.map.routes.length} 条路线</dd>
        </div>
      </div>

      <div class="section-title">被引用最多的条目</div>
      ${
        top.length
          ? `<div class="grid">${top
              .map(({ e }) => {
                const meta = store.typeMeta(e.type);
                return `<article class="card" data-id="${e.id}">
                  <div class="card-top"><span class="type-dot" style="background:${meta.color}"></span><span class="muted small">${meta.label}</span></div>
                  <div class="card-name">${esc(e.name)}</div>
                  <div class="card-sum">${esc(e.summary || e.body.slice(0, 70))}</div>
                </article>`;
              })
              .join('')}</div>`
          : `<div class="empty"><strong>还没有条目</strong>先建一张设定卡，概览会长出内容。</div>`
      }

      <div class="section-title">最近的事件</div>
      ${
        lastEvents.length
          ? `<div class="panel"><div class="rel-list">${lastEvents
              .map(
                (ev) =>
                  `<div class="rel-item"><span class="kind">第 ${ev.year} 年</span><span>${esc(ev.title)}</span><span class="label">${esc(ev.summary)}</span></div>`
              )
              .join('')}</div></div>`
          : `<div class="empty"><strong>时间线是空的</strong>到「时间线」里加第一个事件。</div>`
      }
    `;

    page.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => ctx.navigate(b.dataset.go)));
    page.querySelector('[data-new]').onclick = () => openEntityEditor(null);
    page.querySelector('[data-import]').onclick = () => openImportWizard({ onDone: render });
    page.querySelectorAll('[data-id]').forEach((c) => (c.onclick = () => openEntityEditor(c.dataset.id)));
    page.querySelector('[data-critique]').onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'AI 正在读…';
      try {
        const text = await api.ai('critique', { digest: digest() });
        openModal({
          title: 'AI 审稿意见',
          body: `<div style="white-space:pre-wrap;font-family:var(--serif);font-size:14.5px;line-height:1.85;color:var(--ink-dim)">${esc(text)}</div>`,
          footer: `<span class="spacer"></span><button class="btn" data-copy>复制</button><button class="btn primary" data-ok>知道了</button>`
        }).root.querySelectorAll('[data-copy],[data-ok]').forEach((b) => {
          b.onclick = () => {
            if (b.dataset.copy !== undefined) {
              navigator.clipboard?.writeText(text);
              toast('已复制');
            }
            document.querySelector('#modal-host [data-close]')?.click();
          };
        });
      } catch (err) {
        toast(err.message, 'err', 6000);
      } finally {
        btn.disabled = false;
        btn.textContent = 'AI 审稿';
      }
    };
  }

  render();
  return { refresh: render };
}
