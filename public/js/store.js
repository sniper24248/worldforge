/** 全局状态：世界观数据 + UI 状态 + 撤销栈 + 自动保存 */

export const TYPES = {
  character: { label: '人物', color: '#c9756b', glyph: '☗', plural: '人物' },
  location: { label: '地点', color: '#57b7a8', glyph: '⌖', plural: '地点' },
  faction: { label: '势力', color: '#d8a657', glyph: '⚑', plural: '势力' },
  item: { label: '物品', color: '#6f95c9', glyph: '◆', plural: '物品' },
  concept: { label: '概念', color: '#9b8fd0', glyph: '✦', plural: '概念' }
};

export const REL_KINDS = {
  ally: { label: '同盟', color: '#57b7a8' },
  enemy: { label: '敌对', color: '#c9756b' },
  rival: { label: '竞争', color: '#d8a657' },
  vassal: { label: '从属', color: '#8f8577' },
  kin: { label: '亲缘', color: '#c98fb0' },
  trade: { label: '往来', color: '#6f95c9' },
  controls: { label: '控制', color: '#b08a5a' },
  uses: { label: '使用', color: '#7fa88f' },
  made_in: { label: '产自', color: '#8f9fb5' },
  secret: { label: '隐秘', color: '#9b7fc0' }
};

export const ROUTE_KINDS = {
  sea: { label: '航道', color: '#5f9bb5' },
  road: { label: '陆路', color: '#b59564' },
  dive: { label: '潜线', color: '#6f7fc0' },
  other: { label: '其他', color: '#8f8577' }
};

/** 面状要素的类型：区域 / 湖 / 海 —— 决定填充色与默认名 */
export const REGION_KINDS = {
  land: { label: '陆地', color: '#2f6b6b', fillOpacity: 0.22, name: '陆地' },
  lake: { label: '湖', color: '#3f7fa6', fillOpacity: 0.3, name: '湖泊' },
  sea: { label: '海', color: '#25506e', fillOpacity: 0.34, name: '海域' }
};

/** 线状要素的类型：河 / 公路 / 铁路 / 小径 / 航道 —— 只差颜色和线型 */
export const PATH_KINDS = {
  river: { label: '河流', color: '#4a90b8', width: 2.4, dash: '', name: '河流' },
  road: { label: '公路', color: '#b59564', width: 2.4, dash: '', name: '公路' },
  rail: { label: '铁路', color: '#8f8577', width: 2.2, dash: '9 4', name: '铁路' },
  trail: { label: '小径', color: '#9c8f7a', width: 1.6, dash: '2 5', name: '小径' },
  seaLane: { label: '航道', color: '#5f9bb5', width: 2.2, dash: '7 5', name: '航道' },
  other: { label: '其他', color: '#8f8577', width: 2, dash: '5 4', name: '路径' }
};

/** 老数据的 kind 映射到新 subtype，保证旧世界打开后不会变样 */
const LEGACY_ROUTE = { sea: 'seaLane', road: 'road', dive: 'trail', other: 'other' };


const EMPTY_WORLD = {
  meta: { title: '未命名世界', genre: '', logline: '', worldStyle: '', tone: '' },
  entities: [],
  relations: [],
  events: [],
  gallery: [],
  map: { canvas: { w: 1600, h: 1000 }, bg: null, bgOpacity: 0.45, regions: [], pins: [], routes: [] }
};

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/** 把从磁盘读到的数据补齐成完整形状，容忍旧版本 / 手工编辑的 JSON */
export function normalize(raw) {
  const w = { ...structuredClone(EMPTY_WORLD), ...(raw && typeof raw === 'object' ? raw : {}) };
  w.meta = { ...EMPTY_WORLD.meta, ...(w.meta || {}) };
  for (const key of ['entities', 'relations', 'events', 'gallery']) {
    if (!Array.isArray(w[key])) w[key] = [];
  }
  w.entities = w.entities.map((e) => ({
    id: e.id || uid('ent'),
    type: TYPES[e.type] ? e.type : 'character',
    name: e.name || '未命名',
    aliases: Array.isArray(e.aliases) ? e.aliases : splitList(e.aliases),
    summary: e.summary || '',
    body: e.body || '',
    tags: Array.isArray(e.tags) ? e.tags : splitList(e.tags),
    fields: e.fields && typeof e.fields === 'object' ? e.fields : {},
    images: Array.isArray(e.images) ? e.images : [],
    graph: { x: Number(e.graph?.x) || 0, y: Number(e.graph?.y) || 0 },
    createdAt: e.createdAt || new Date().toISOString()
  }));
  w.relations = w.relations.map((r) => ({
    id: r.id || uid('rel'),
    from: r.from,
    to: r.to,
    kind: REL_KINDS[r.kind] ? r.kind : 'ally',
    label: r.label || ''
  }));
  w.events = w.events.map((ev) => ({
    id: ev.id || uid('ev'),
    title: ev.title || '未命名事件',
    year: Number(ev.year) || 0,
    thread: ev.thread || '主线',
    summary: ev.summary || '',
    entityIds: Array.isArray(ev.entityIds) ? ev.entityIds : []
  }));
  w.gallery = w.gallery.map((g) => ({
    id: g.id || uid('img'),
    file: g.file,
    prompt: g.prompt || '',
    provider: g.provider || 'comfyui',
    createdAt: g.createdAt || new Date().toISOString(),
    entityId: g.entityId || null
  }));
  const m = w.map && typeof w.map === 'object' ? w.map : {};
  w.map = {
    canvas: { w: Number(m.canvas?.w) || 1600, h: Number(m.canvas?.h) || 1000 },
    bg: m.bg || null,
    bgOpacity: typeof m.bgOpacity === 'number' ? clamp(m.bgOpacity, 0, 1) : 0.45,
    regions: (Array.isArray(m.regions) ? m.regions : []).map((r) => ({
      id: r.id || uid('rg'),
      name: r.name || '区域',
      subtype: REGION_KINDS[r.subtype] ? r.subtype : 'land',
      color: r.color || (REGION_KINDS[r.subtype] || REGION_KINDS.land).color,
      points: (r.points || []).map((p) => [Number(p[0]) || 0, Number(p[1]) || 0]),
      labelAt: Array.isArray(r.labelAt) && r.labelAt.length === 2 ? [Number(r.labelAt[0]) || 0, Number(r.labelAt[1]) || 0] : null
    })),
    pins: (Array.isArray(m.pins) ? m.pins : []).map((p) => ({
      id: p.id || uid('pin'),
      label: p.label || '地点',
      entityId: p.entityId || null,
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      size: p.size || 'site'
    })),
    routes: (Array.isArray(m.routes) ? m.routes : []).map((r) => ({
      id: r.id || uid('rt'),
      label: r.label || '',
      kind: ROUTE_KINDS[r.kind] ? r.kind : 'sea',
      subtype: PATH_KINDS[r.subtype] ? r.subtype : LEGACY_ROUTE[r.kind] || 'road',
      points: (r.points || []).map((p) => [Number(p[0]) || 0, Number(p[1]) || 0])
    }))
  };
  return w;
}

export function splitList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v).split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
}

const listeners = new Set();

export const store = {
  world: normalize(null),
  worlds: [],
  activeId: null,
  ui: {
    route: 'overview',
    selection: { type: null, id: null },
    filters: { q: '', types: new Set(), tag: null },
    providerStatus: null
  },
  saveState: 'idle',
  version: 0,
  _undo: [],
  _redo: [],
  _saveTimer: null,
  _saving: false,
  _pending: false,

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit() {
    this.version += 1;
    for (const fn of listeners) fn(this);
  },

  async load(id) {
    const target = id || this.activeId;
    const res = await fetch(`/api/world${target ? `?world=${encodeURIComponent(target)}` : ''}`);
    if (!res.ok) throw new Error(`读取数据失败：HTTP ${res.status}`);
    const data = await res.json();
    this.world = normalize(data.world);
    if (data.id) this.activeId = data.id;
    this.saveState = 'saved';
    this.emit();
  },

  /* ---------- 世界观目录 ---------- */

  async loadIndex() {
    const res = await fetch('/api/worlds');
    if (!res.ok) throw new Error(`读取世界列表失败：HTTP ${res.status}`);
    const data = await res.json();
    this.worlds = data.worlds || [];
    this.activeId = data.active || this.activeId;
    return data;
  },

  async switchTo(id) {
    if (!id || id === this.activeId) return;
    clearTimeout(this._saveTimer);
    await this.flush();
    const res = await fetch(`/api/worlds/${encodeURIComponent(id)}/activate`, { method: 'POST' });
    if (!res.ok) throw new Error('切换世界失败');
    this._undo.length = 0;
    this._redo.length = 0;
    await this.load(id);
    await this.loadIndex();
    this.emit();
  },

  async createWorld(title) {
    const res = await fetch('/api/worlds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title })
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || '新建世界失败');
    this._undo.length = 0;
    this._redo.length = 0;
    await this.loadIndex();
    await this.load(data.id);
    this.emit();
    return data.id;
  },

  async renameWorld(id, title) {
    const res = await fetch(`/api/worlds/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title })
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || '重命名失败');
    if (id === this.activeId) this.world.meta.title = title;
    await this.loadIndex();
    this.emit();
  },

  async deleteWorld(id) {
    const res = await fetch(`/api/worlds/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || '删除失败');
    this._undo.length = 0;
    this._redo.length = 0;
    await this.loadIndex();
    await this.load(data.active);
    this.emit();
    return data.active;
  },

  /** 所有写操作都走这里：快照 → 修改 → 通知 → 自动保存 */
  commit(mutator, { save = true, label = '' } = {}) {
    const snapshot = JSON.stringify(this.world);
    const result = mutator(this.world);
    this._undo.push(snapshot);
    if (this._undo.length > 40) this._undo.shift();
    this._redo.length = 0;
    if (label) console.debug('[commit]', label);
    this.emit();
    if (save) this.scheduleSave();
    return result;
  },

  /** 不留撤销记录的写操作（拖拽中的高频更新用这个） */
  touch(mutator) {
    mutator(this.world);
    this.emit();
    this.scheduleSave();
  },

  undo() {
    const prev = this._undo.pop();
    if (!prev) return toastNothing();
    this._redo.push(JSON.stringify(this.world));
    this.world = normalize(JSON.parse(prev));
    this.saveState = 'saving';
    this.emit();
    this.scheduleSave(80);
  },
  redo() {
    const next = this._redo.pop();
    if (!next) return;
    this._undo.push(JSON.stringify(this.world));
    this.world = normalize(JSON.parse(next));
    this.emit();
    this.scheduleSave(80);
  },

  scheduleSave(delay = 600) {
    this.saveState = 'saving';
    this.emit();
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), delay);
  },

  async flush() {
    if (this._saving) {
      this._pending = true;
      return;
    }
    this._saving = true;
    try {
      const res = await fetch(`/api/world${this.activeId ? `?world=${encodeURIComponent(this.activeId)}` : ''}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(this.world)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.saveState = 'saved';
    } catch (err) {
      this.saveState = 'error';
      console.error('[save]', err);
      toast(`保存失败：${err.message}`, 'err');
    } finally {
      this._saving = false;
      this.emit();
      if (this._pending) {
        this._pending = false;
        this.flush();
      }
    }
  },

  /* ---------- 查询辅助 ---------- */
  entity(id) {
    return this.world.entities.find((e) => e.id === id) || null;
  },
  relationsOf(id) {
    return this.world.relations.filter((r) => r.from === id || r.to === id);
  },
  eventsOf(id) {
    return this.world.events.filter((ev) => ev.entityIds.includes(id));
  },
  imagesOf(id) {
    const ent = this.entity(id);
    const own = ent ? ent.images.map((f) => ({ file: f })) : [];
    const gal = this.world.gallery.filter((g) => g.entityId === id).map((g) => ({ file: g.file, gallery: g }));
    return [...own, ...gal];
  },
  typeMeta(t) {
    return TYPES[t] || { label: t, color: '#8f8577', glyph: '·' };
  }
};

function toastNothing() {
  /* 无历史时不做事；toast 由 app 注入，避免循环依赖 */
}

export { clamp };
