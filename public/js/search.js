/** 模糊搜索：分词 + 子序列 + 小编辑距离 + 拼音 + 字段权重 + 命中高亮 */

import { PY_BUCKETS } from './pinyin-data.js';

const FIELD_WEIGHT = {
  name: 120,
  alias: 90,
  tags: 70,
  summary: 45,
  fields: 35,
  body: 15
};

/* ---------- 拼音 ---------- */

let charToSyllable = null;

function ensurePinyin() {
  if (charToSyllable) return charToSyllable;
  charToSyllable = new Map();
  for (const [syl, chars] of Object.entries(PY_BUCKETS)) {
    for (const ch of chars) charToSyllable.set(ch, syl);
  }
  return charToSyllable;
}

/** 把一个中文串转成 { full: 'kongwan', initials: 'kw' } */
export function toPinyin(text) {
  const map = ensurePinyin();
  let full = '';
  let initials = '';
  for (const ch of String(text || '')) {
    const syl = map.get(ch);
    if (syl) {
      full += syl;
      initials += syl[0];
    } else if (/[a-z0-9]/i.test(ch)) {
      const c = ch.toLowerCase();
      full += c;
      initials += c;
    }
  }
  return { full, initials };
}

const pinyinCache = new Map();

function pinyinOf(entity) {
  const key = `${entity.id}|${entity.name}|${(entity.aliases || []).join(',')}`;
  const hit = pinyinCache.get(key);
  if (hit) return hit;
  const value = toPinyin(`${entity.name}${(entity.aliases || []).join('')}`);
  if (pinyinCache.size > 2000) pinyinCache.clear();
  pinyinCache.set(key, value);
  return value;
}

/* ---------- 文本匹配 ---------- */

export function tokenize(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .split(/[\s,，、/]+/)
    .filter(Boolean);
}

function subsequence(hay, needle) {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

function withinEditDistance(a, b, max = 1) {
  if (Math.abs(a.length - b.length) > max) return false;
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++diff > max) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return diff + (a.length - i) + (b.length - j) <= max;
}

function fieldText(entity) {
  return {
    name: `${entity.name} ${(entity.aliases || []).join(' ')}`.toLowerCase(),
    alias: (entity.aliases || []).join(' ').toLowerCase(),
    tags: (entity.tags || []).join(' ').toLowerCase(),
    summary: String(entity.summary || '').toLowerCase(),
    fields: Object.entries(entity.fields || {})
      .map(([k, v]) => `${k} ${v}`)
      .join(' ')
      .toLowerCase(),
    body: String(entity.body || '').toLowerCase()
  };
}

/**
 * 返回 { score, hitField } 或 null。
 * 每个词都要在某个字段命中；中文走子串/子序列，纯字母走拼音全拼与首字母。
 */
export function scoreEntity(entity, tokens) {
  if (!tokens.length) return { score: 0, hitField: null };
  const text = fieldText(entity);
  let total = 0;
  let hitField = null;

  for (const token of tokens) {
    let best = 0;
    let bestField = null;

    for (const [field, value] of Object.entries(text)) {
      if (!value) continue;
      const w = FIELD_WEIGHT[field] || 10;
      let s = 0;
      const idx = value.indexOf(token);
      if (idx === 0) s = w * 1.6;
      else if (idx > 0) s = w;
      else if (token.length >= 2 && subsequence(value, token)) s = w * 0.45;
      else if (token.length >= 3 && field === 'name' && withinEditDistance(value.split(' ')[0], token)) s = w * 0.5;

      if (s > best) {
        best = s;
        bestField = field;
      }
    }

    // 纯字母查询 → 拼音（全拼 / 首字母）
    if (!best && /^[a-z0-9]+$/.test(token)) {
      const py = pinyinOf(entity);
      if (py.full.startsWith(token)) {
        best = FIELD_WEIGHT.name * 1.1;
        bestField = 'name';
      } else if (py.full.includes(token)) {
        best = FIELD_WEIGHT.name * 0.85;
        bestField = 'name';
      } else if (token.length >= 2 && py.initials.startsWith(token)) {
        best = FIELD_WEIGHT.name * 0.75;
        bestField = 'name';
      } else if (token.length >= 3 && py.initials.includes(token)) {
        best = FIELD_WEIGHT.name * 0.5;
        bestField = 'name';
      }
    }

    if (!best) return null;
    total += best;
    if (!hitField) hitField = bestField;
  }

  return { score: total, hitField };
}

/** 中文命中才高亮；拼音命中没有连续片段可标，保持原样 */
export function highlight(text, tokens) {
  const src = String(text || '');
  if (!tokens.length || !src) return escapeHtml(src);
  const lower = src.toLowerCase();
  const ranges = [];
  for (const token of tokens) {
    if (!/[\u4e00-\u9fa5]/.test(token)) continue;
    let from = 0;
    while (from <= lower.length) {
      const at = lower.indexOf(token, from);
      if (at < 0) break;
      ranges.push([at, at + token.length]);
      from = at + token.length;
    }
  }
  if (!ranges.length) return escapeHtml(src);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  let out = '';
  let cursor = 0;
  for (const [s, e] of merged) {
    out += escapeHtml(src.slice(cursor, s));
    out += `<mark>${escapeHtml(src.slice(s, e))}</mark>`;
    cursor = e;
  }
  out += escapeHtml(src.slice(cursor));
  return out;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
