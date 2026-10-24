/** 应用入口：路由、导航、世界观目录、全局快捷键、保存状态、配色 */

import { store, TYPES } from './store.js';
import { esc, toast, promptDialog, confirmDialog } from './ui.js';
import { applyTheme, cycleTheme, themeMeta, themeLabel } from './theme.js';
import { initLang, t, applyStaticText, bootLocalizer, getLang } from './i18n.js';
import * as overview from './views/overview.js';
import * as cards from './views/cards.js';
import * as graph from './views/graph.js';
import * as timeline from './views/timeline.js';
import * as mapView from './views/map.js';
import * as studio from './views/studio.js';
import * as settings from './views/settings.js';

const ROUTES = {
  overview: { label: '世界概览', icon: 'i-compass', view: overview },
  cards: { label: '设定卡库', icon: 'i-cards', view: cards },
  graph: { label: '关系图', icon: 'i-graph', view: graph },
  timeline: { label: '时间线', icon: 'i-timeline', view: timeline },
  map: { label: '地图', icon: 'i-map', view: mapView },
  studio: { label: '生图工坊', icon: 'i-spark', view: studio },
  settings: { label: '设置', icon: 'i-gear', view: settings }
};

const stage = document.getElementById('stage');
let active = null;
let activeRoute = null;

export function navigate(route, params = {}) {
  const hash = `#/${route}${params.entity ? `?entity=${encodeURIComponent(params.entity)}` : ''}`;
  if (location.hash === hash) {
    renderRoute();
  } else {
    location.hash = hash;
  }
}

function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, '') || 'overview';
  const [name, query] = raw.split('?');
  const params = new URLSearchParams(query || '');
  return { name: ROUTES[name] ? name : 'overview', params };
}

function renderRail() {
  const nav = document.getElementById('nav');
  const counts = { cards: store.world.entities.length, timeline: store.world.events.length };
  nav.innerHTML = Object.entries(ROUTES)
    .map(([key, r]) => {
      const c = counts[key];
      return `<button class="nav-item ${key === activeRoute ? 'active' : ''}" data-route="${key}">
        <svg class="ico"><use href="#${r.icon}" /></svg>
        <span>${esc(t(r.label))}</span>
        ${c ? `<em class="count">${c}</em>` : ''}
      </button>`;
    })
    .join('');
  nav.onclick = (e) => {
    const btn = e.target.closest('[data-route]');
    if (btn) navigate(btn.dataset.route);
  };
  renderSwitcher();
}

/* ---------- 世界观目录 ---------- */

let worldMenuOpen = false;

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';
  const m = Math.floor(diff / 60000);
  if (m < 1) return t('刚刚改过');
  if (m < 60) return `${m} ${t('分钟前')}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${t('小时前')}`;
  return `${Math.floor(h / 24)} ${t('天前')}`;
}

function renderSwitcher() {
  const host = document.getElementById('world-switch-host');
  if (!host) return;
  const title = store.world.meta.title || t('未命名世界');
  host.innerHTML = `
    <button class="world-switch" id="ws-btn" title="${esc(t('切换世界观'))}">
      <span class="ws-dot"></span>
      <span class="ws-text">
        <b>${esc(title)}</b>
        <em>${esc(t(`${store.worlds.length || 1} 个世界 · ${store.world.entities.length} 条设定`))}</em>
      </span>
      <svg class="ico ws-caret"><use href="#i-chevron" /></svg>
    </button>
    <div class="world-menu" id="world-menu" hidden></div>`;
  host.querySelector('#ws-btn').onclick = (e) => {
    e.stopPropagation();
    toggleWorldMenu();
  };
  if (worldMenuOpen) {
    const menu = host.querySelector('#world-menu');
    menu.hidden = false;
    renderWorldMenu(menu);
  }
}

function toggleWorldMenu(force) {
  const menu = document.getElementById('world-menu');
  if (!menu) return;
  worldMenuOpen = typeof force === 'boolean' ? force : menu.hidden;
  menu.hidden = !worldMenuOpen;
  if (worldMenuOpen) renderWorldMenu(menu);
}

function closeWorldMenu() {
  const menu = document.getElementById('world-menu');
  worldMenuOpen = false;
  if (menu) menu.hidden = true;
}

function renderWorldMenu(menu) {
  const rows = store.worlds
    .map((w) => {
      const isActive = w.id === store.activeId;
      return `<button class="world-item ${isActive ? 'active' : ''}" data-id="${esc(w.id)}">
        <div class="wi-main">
          <span class="wi-title">${esc(w.title || t('未命名世界'))}</span>
          <span class="wi-meta">${esc(t(`${w.counts.entities} 条设定`))} · ${esc(timeAgo(w.updatedAt) || t('还没动过'))}</span>
        </div>
        ${isActive ? `<span class="wi-count">${esc(t('当前'))}</span>` : ''}
      </button>`;
    })
    .join('');

  menu.innerHTML = `
    <div class="wm-head">${esc(t('世界观目录'))}</div>
    <div class="wm-list">${rows || `<div class="muted small" style="padding:8px">${esc(t('还没有世界'))}</div>`}</div>
    <div class="wm-actions">
      <button class="btn small" data-act="new">＋ ${esc(t('新建'))}</button>
      <button class="btn small" data-act="rename">${esc(t('重命名'))}</button>
      <button class="btn small" data-act="duplicate">${esc(t('复制当前'))}</button>
      <button class="btn danger small" data-act="delete">${esc(t('删除当前'))}</button>
    </div>`;

  menu.onclick = async (e) => {
    e.stopPropagation();
    const item = e.target.closest('[data-id]');
    if (item) return switchWorld(item.dataset.id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    await handleWorldAction(act);
  };
}

async function switchWorld(id) {
  closeWorldMenu();
  if (id === store.activeId) return;
  try {
    await store.switchTo(id);
    renderRoute();
    toast(`${t('已切到')}「${store.world.meta.title}」`);
  } catch (err) {
    toast(err.message, 'err', 5000);
  }
}

async function handleWorldAction(act) {
  const title = store.world.meta.title || t('未命名世界');
  try {
    if (act === 'new') {
      const name = await promptDialog({ title: t('新建世界观'), label: t('名字'), value: '', placeholder: t('比如：灰潮纪元') });
      if (!name) return;
      await store.createWorld(name);
      closeWorldMenu();
      renderRoute();
      toast(`${t('已新建')}「${name}」`);
    } else if (act === 'rename') {
      const name = await promptDialog({ title: t('重命名'), label: t('世界名'), value: title });
      if (!name || name === title) return;
      await store.renameWorld(store.activeId, name);
      closeWorldMenu();
      renderRoute();
    } else if (act === 'duplicate') {
      const snapshot = structuredClone(store.world);
      const newTitle = `${title} ${t('副本')}`;
      snapshot.meta = { ...snapshot.meta, title: newTitle };
      const id = await store.createWorld(newTitle);
      await fetch(`/api/world?world=${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(snapshot)
      });
      await store.load(id);
      closeWorldMenu();
      renderRoute();
      toast(`${t('已复制成')}「${newTitle}」`);
    } else if (act === 'delete') {
      if (store.worlds.length <= 1) return toast(t('至少留一个世界'), 'err');
      const ok = await confirmDialog({
        title: t('删除世界观'),
        message: `${t('删掉')}「${title}」？${t('里面的')} ${store.world.entities.length} ${t('条设定')}、${store.world.events.length} ${t('个事件')}${t('都会消失，删了不能撤销。')}`,
        confirmText: t('删除'),
        danger: true
      });
      if (!ok) return;
      await store.deleteWorld(store.activeId);
      closeWorldMenu();
      renderRoute();
      toast(t('已删除'));
    }
  } catch (err) {
    toast(err.message, 'err', 5000);
  }
}

/* ---------- 保存状态 ---------- */

function renderSaveState() {
  const node = document.getElementById('save-state');
  const map = {
    idle: '已就绪',
    loading: '载入中…',
    saving: '保存中…',
    saved: '已保存到磁盘',
    error: '保存失败'
  };
  node.textContent = t(map[store.saveState] || '');
  node.className = `save-state ${store.saveState}`;
}

/* ---------- 路由渲染 ---------- */

function renderRoute() {
  const { name, params } = currentRoute();
  activeRoute = name;
  renderRail();
  if (active && typeof active.destroy === 'function') active.destroy();
  stage.innerHTML = '';
  stage.scrollTop = 0;
  const ctx = { navigate, params, rerender: () => renderRoute() };
  try {
    active = ROUTES[name].view.mount(stage, ctx) || {};
    activeRoute = name;
  } catch (err) {
    console.error(err);
    stage.innerHTML = `<div class="page"><div class="empty"><strong>${esc(t('这个视图出错了'))}</strong>${esc(err.message)}</div></div>`;
    active = null;
  }
  document.title = `${store.world.meta.title || 'WorldForge'} · WorldForge`;
  renderRail();
}

/* ---------- 全局事件 ---------- */

store.subscribe(() => {
  renderSaveState();
  if (active && typeof active.refresh === 'function') {
    try {
      active.refresh();
    } catch (err) {
      console.error('[refresh]', err);
    }
  }
  renderRail();
});

window.addEventListener('hashchange', renderRoute);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && worldMenuOpen) closeWorldMenu();
  const typing =
    /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) {
    e.preventDefault();
    store.redo();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    store.flush().then(() => toast(t('已保存')));
  }
});

document.getElementById('btn-undo').addEventListener('click', () => store.undo());

/* ---------- 配色 ---------- */

function renderThemeLabel() {
  const label = document.getElementById('btn-theme-label');
  const btn = document.getElementById('btn-theme');
  if (label) label.textContent = themeLabel(themeMeta());
  if (btn) btn.title = t('点击切换配色；到「设置 → 外观」可自定义强调色');
}

function initTheme() {
  applyTheme();
  renderThemeLabel();
  document.getElementById('btn-theme').addEventListener('click', () => {
    const next = cycleTheme();
    renderThemeLabel();
    toast(`${t('配色：')}${themeLabel(next)}`);
    if (activeRoute === 'settings' && active && typeof active.refresh === 'function') active.refresh();
  });
}

// 点空白处收起世界目录
document.addEventListener('pointerdown', (e) => {
  if (!worldMenuOpen) return;
  if (e.target.closest('#world-menu') || e.target.closest('#ws-btn')) return;
  closeWorldMenu();
});

/* ---------- 启动 ---------- */

async function boot() {
  initLang();
  initTheme();
  applyStaticText();
  bootLocalizer();
  store.saveState = 'loading';
  renderSaveState();
  try {
    await store.loadIndex();
    await store.load(store.activeId);
  } catch (err) {
    stage.innerHTML = `<div class="page"><div class="empty"><strong>${esc(t('连不上 WorldForge 后端'))}</strong>${esc(err.message)}<br><br>${esc(t('确认 server.mjs 还在跑'))} <code class="mono">node server.mjs</code></div></div>`;
    return;
  }
  renderSaveState();
  renderRoute();
  if (store.world.entities.length && store.world.entities.every((e) => !e.graph.x && !e.graph.y)) {
    seedGraphPositions();
  }
  window.__WORLDFORGE_READY__ = true;
}

export function seedGraphPositions() {
  const list = store.world.entities;
  const R = Math.min(420, 120 + list.length * 16);
  list.forEach((e, i) => {
    const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
    e.graph.x = Math.round(Math.cos(a) * R);
    e.graph.y = Math.round(Math.sin(a) * R * 0.72);
  });
  store.scheduleSave(200);
}

export { TYPES, getLang };
boot();
