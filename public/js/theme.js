/** 主题：预设配色 + 自定义强调色，存在 localStorage */

import { getLang } from './i18n.js';

export const THEMES = [
  { id: 'amber', name: '暗 · 琥珀', nameEn: 'Amber', hint: '默认 / 羊皮纸暖金', hintEn: 'Default warm gold', bg: '#100e0c', panel: '#1b1713', ink: '#eae1d2', accent: '#d8a657' },
  { id: 'ink', name: '暗 · 青瓷', nameEn: 'Ink', hint: '冷青，偏冷静', hintEn: 'Cool teal', bg: '#0b1014', panel: '#131d23', ink: '#dbe7ec', accent: '#6ebecd' },
  { id: 'paper', name: '亮 · 羊皮纸', nameEn: 'Paper', hint: '暖白纸感', hintEn: 'Warm paper', bg: '#f2ebdf', panel: '#fbf6ec', ink: '#2b2318', accent: '#a66f20' },
  { id: 'snow', name: '亮 · 雪', nameEn: 'Snow', hint: '冷白，干净', hintEn: 'Cool white', bg: '#f4f6f8', panel: '#ffffff', ink: '#1d2733', accent: '#3478be' }
];

/** 当前语言下的主题名与说明 */
export function themeLabel(meta = themeMeta()) {
  return getLang() === 'en' ? meta.nameEn || meta.name : meta.name;
}

export function themeHint(meta = themeMeta()) {
  return getLang() === 'en' ? meta.hintEn || meta.hint : meta.hint;
}

const KEY = 'wf.theme';
const ACCENT_KEY = 'wf.accent';
const DEFAULT_ACCENTS = Object.fromEntries(THEMES.map((t) => [t.id, t.accent]));

export function getTheme() {
  const v = localStorage.getItem(KEY);
  return THEMES.some((t) => t.id === v) ? v : 'amber';
}

export function themeMeta(id = getTheme()) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

export function isLight(id = getTheme()) {
  return id === 'paper' || id === 'snow';
}

export function getAccent() {
  return localStorage.getItem(ACCENT_KEY) || '';
}

export function defaultAccent(themeId = getTheme()) {
  return DEFAULT_ACCENTS[themeId] || '#d8a657';
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** 把主题写进 <html data-theme>，自定义强调色用内联变量覆盖 */
export function applyTheme(themeId = getTheme(), accent = getAccent()) {
  const root = document.documentElement;
  root.dataset.theme = themeId;
  const rgb = accent ? hexToRgb(accent) : null;
  if (rgb) {
    root.style.setProperty('--amber', accent);
    root.style.setProperty('--accent-rgb', rgb);
    root.style.setProperty('--amber-soft', `rgba(${rgb}, 0.14)`);
  } else {
    root.style.removeProperty('--amber');
    root.style.removeProperty('--accent-rgb');
    root.style.removeProperty('--amber-soft');
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#100e0c');
}

export function setTheme(id) {
  if (!THEMES.some((t) => t.id === id)) return;
  localStorage.setItem(KEY, id);
  applyTheme(id);
}

export function setAccent(hex) {
  if (hex) localStorage.setItem(ACCENT_KEY, hex);
  else localStorage.removeItem(ACCENT_KEY);
  applyTheme();
}

export function cycleTheme() {
  const i = THEMES.findIndex((t) => t.id === getTheme());
  const next = THEMES[(i + 1) % THEMES.length];
  setTheme(next.id);
  return next;
}
