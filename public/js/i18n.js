/**
 * 界面语言。
 *
 * 两种用法：
 *  1. 代码里显式 t('保存') —— 适合带插值的句子；
 *  2. 渲染后整页本地化 localizeDom() —— 按「中文原文」精确匹配替换文本节点与
 *     placeholder/title/aria-label，漏翻的地方自动回落中文。
 *     MutationObserver 盯着 DOM，视图重渲染后自动再翻一遍。
 *
 * 只做精确匹配，不给正文套正则，避免把用户写的设定文字也改掉。
 */

const STORAGE_KEY = 'wf.lang';
const CJK = /[\u4e00-\u9fa5]/;

const EN = {
  // 外壳 / 导航
  "世界概览": 'Overview',
  "设定卡库": 'Cards',
  "关系图": 'Graph',
  "时间线": 'Timeline',
  "地图": 'Map',
  "生图工坊": 'Images',
  "设置": 'Settings',
  "世界观锻造炉": 'World Forge',
  "配色": 'Theme',
  "撤销": 'Undo',
  "已保存到磁盘": 'Saved to disk',
  "保存中…": 'Saving…',
  "已就绪": 'Ready',
  "载入中…": 'Loading…',
  "保存失败": 'Save failed',
  "自动保存状态": 'Autosave status',
  "切换配色（点击循环）": 'Switch theme (click to cycle)',
  "撤销快捷键": 'Undo (Ctrl+Z)',

  // 世界目录
  "世界观目录": 'Worlds',
  "切换世界观": 'Switch world',
  "新建世界观": 'New world',
  "重命名": 'Rename',
  "新建": 'New',
  "复制当前": 'Duplicate',
  "删除当前": 'Delete',
  "当前": 'current',
  "还没有世界": 'No worlds yet',
  "还没动过": 'not touched yet',
  "刚刚改过": 'just now',
  "分钟前": 'min ago',
  "小时前": 'h ago',
  "天前": 'd ago',
  "名字": 'Name',
  "世界名": 'World name',
  "复制副本": 'copy',
  "副本": 'copy',
  "已切到": 'Switched to',
  "已新建": 'Created',
  "已复制成": 'Duplicated as',
  "至少留一个世界": 'Keep at least one world',
  "删除世界观": 'Delete world',
  "删掉": 'Delete',
  "里面的": '',
  "都会消失，删了不能撤销。": ' will be gone. This cannot be undone.',
  "比如：灰潮纪元": 'e.g. Grey Tide',
  "切换世界失败": 'Failed to switch world',
  "新建世界失败": 'Failed to create world',
  "重命名失败": 'Rename failed',
  "删除失败": 'Delete failed',

  // 通用
  "确定": 'OK',
  "取消": 'Cancel',
  "保存": 'Save',
  "删除": 'Delete',
  "关闭": 'Close',
  "编辑": 'Edit',
  "搜索": 'Search',
  "标签": 'Tags',
  "名称": 'Name',
  "类型": 'Type',
  "一句话": 'One-liner',
  "关系": 'Relations',
  "图集": 'Images',
  "摘要": 'Summary',
  "标题": 'Title',
  "线索": 'Thread',
  "年份（公元前用负数）": 'Year (negative for BCE)',
  "关联条目": 'Linked entries',
  "添加": 'Add',
  "全部": 'All',
  "人物": 'Characters',
  "地点": 'Places',
  "势力": 'Factions',
  "物品": 'Items',
  "概念": 'Concepts',
  "未命名世界": 'Untitled world',
  "未命名事件": 'Untitled event',
  "未命名条目": 'Untitled entry',
  "未命名": 'Untitled',

  // 关系 / 路线类型
  "同盟": 'Ally',
  "敌对": 'Enemy',
  "竞争": 'Rival',
  "从属": 'Vassal',
  "亲缘": 'Kin',
  "往来": 'Trade',
  "控制": 'Controls',
  "使用": 'Uses',
  "产自": 'Made in',
  "隐秘": 'Secret',
  "航道": 'Sea route',
  "陆路": 'Road',
  "潜线": 'Dive line',
  "其他": 'Other',
  "主线": 'Main',
  "区域": 'Region',
  "地点": 'Place',
  "据点": 'Site',
  "城市": 'City',
  "遗迹": 'Ruin',

  // 设置
  "外观": 'Appearance',
  "自定义强调色": 'Custom accent',
  "用主题默认色": 'Use theme default',
  "世界信息": 'World info',
  "生图通道": 'Image providers',
  'AI 文本辅助（可选）': 'AI text helpers (optional)',
  "数据": 'Data',
  "保存世界信息": 'Save world info',
  "地图画布": 'Map canvas',
  "世界信息存进 world.json；通道与密钥存在本机 data/config.json，不会上传":
    'World data lives in world.json; provider and keys stay local in data/config.json',
  "生图风格提示词": 'Style prompt',
  "英文关键词最稳，会拼到每次生成的提示词末尾": 'English keywords work best — appended to every image prompt',
  "基调": 'Tone',
  "一句话梗概": 'Logline',
  "本地 ComfyUI": 'Local ComfyUI',
  '智谱 CogView / GLM-Image': 'Zhipu CogView / GLM-Image',
  'ComfyUI 地址': 'ComfyUI URL',
  "默认模型": 'Default model',
  "步数": 'Steps',
  "采样器": 'Sampler',
  "调度器": 'Scheduler',
  "测试连接": 'Test connection',
  "连接中…": 'Connecting…',
  "连不上": 'unreachable',
  "在线": 'online',
  "个模型": 'models',
  '智谱 API Key': 'Zhipu API key',
  "模型": 'Model',
  'Base URL': 'Base URL',
  'API Key': 'API key',
  "留空保存会保留原 Key。也可以设环境变量": 'Leave empty to keep the current key. Env var also works:',
  '发一个「ok」测试': 'Send an "ok" test',
  "保存通道设置": 'Save provider settings',
  "保存后立刻生效，不用重启": 'Takes effect immediately',
  "数据就在": 'Data lives in',
  "自动备份": 'Back up',
  "导出世界 JSON": 'Export world JSON',
  "导入 JSON": 'Import JSON',
  "导出 Markdown 设定集": 'Export Markdown',
  "清空所有设定": 'Wipe everything',
  "导出": 'Export',
  "备份": 'Backup',
  "导入世界": 'Import world',
  "覆盖导入": 'Overwrite',
  "全部清空": 'Wipe all',
  "会删掉全部条目、关系、事件和地图。图片文件不会删，但图库记录会清空。这个操作不能撤销。":
    'This deletes every entry, relation, event and the map. Image files stay on disk, but gallery records are cleared. Cannot be undone.',
  "用「{}」覆盖当前世界？当前内容会被替换（可以先导出备份）。": 'Replace the current world with "{}"? Existing content will be overwritten.',
  "解析失败：": 'Parse failed: ',
  "已导出": 'Exported',
  "已导入": 'Imported',
  "已清空": 'Wiped',
  "世界信息已保存": 'World info saved',
  "通道设置已保存": 'Provider settings saved',
  "已恢复主题默认强调色": 'Accent reset',
  'AI 通路正常：': 'AI reachable: ',
  "测试：请只回复「ok」。": 'Test: reply with "ok" only.',
  "界面语言": 'Language',
  "语言": 'Language',
  "当前语言": 'Current language',

  // 概览
  "还没有写一句话梗概。到「设置」里填，或者在设定卡库里先堆素材。":
    'No logline yet. Fill it in Settings, or just start stacking cards.',
  "新设定": 'New entry',
  "导入 txt": 'Import txt',
  "看关系图": 'Open graph',
  "看地图": 'Open map',
  "生一张图": 'Generate image',
  'AI 审稿': 'AI review',
  'AI 正在读…': 'AI reading…',
  'AI 审稿意见': 'AI review notes',
  "世界基调": 'Tone & style',
  "风格提示词": 'Style prompt',
  '（未填，生图会退化成通用奇幻）': '(empty — images fall back to generic fantasy)',
  "（未填）": '(empty)',
  "被引用最多的条目": 'Most referenced',
  "还没有条目": 'No entries yet',
  "先建一张设定卡，概览会长出内容。": 'Create one card and this page fills up.',
  "最近的事件": 'Recent events',
  "时间线是空的": 'Timeline is empty',
  "到「时间线」里加第一个事件。": 'Add your first event in Timeline.',
  "加第一个事件：谁、哪一年、发生了什么。": 'Add the first event: who, which year, what happened.',
  "拖动卡片可改年份": 'drag a card to change its year',
  "复制": 'Copy',
  "知道了": 'Got it',
  "已复制": 'Copied',

  // 卡片页
  "张卡": 'cards',
  "人物、地点、势力、物品都在这里": 'characters, places, factions, items',
  "条结果": 'results',
  '搜索名称、正文、标签…': 'Search name, body, tags…',
  "按类型": 'By type',
  "按名称": 'By name',
  "最近创建": 'Newest',
  "环形重排关系图": 'Re-layout graph',
  "新建设定": 'New entry',
  "新建条目": 'New entry',
  "这个世界的设定还是空的": 'This world is empty',
  "从一个人物、一座城，或者一件道具开始。": 'Start with a character, a city, or an item.',
  "没有匹配的设定": 'Nothing matched',
  "换个关键词，或者清掉筛选。": 'Try another keyword, or clear the filters.',
  "还没写": 'empty',
  "关系图已重排": 'Graph re-laid out',
  "有欲望、有秘密的人": 'Someone with wants and secrets',
  "一座城、房间、野外": 'A city, a room, the wild',
  "组织、教团、家族": 'Guilds, cults, families',
  "器物、兵器、遗迹": 'Objects, weapons, ruins',
  "体系、规则、风俗、技术": 'Systems, rules, customs, tech',

  // 关系图
  "连线": 'Link',
  "点是目标": 'pick target',
  "整理布局": 'Tidy layout',
  "显示说明": 'Show labels',
  "隐藏说明": 'Hide labels',
  "复位": 'Reset',
  "新条目": 'New entry',
  "先点一个节点作为起点": 'Click a node first',
  "现在点目标节点": 'Now click the target node',
  "建立关系": 'Create relation',
  '从 → 到': 'From → To',
  "说明": 'Label',
  "建立": 'Create',
  "编辑关系": 'Edit relation',
  "关系已建立": 'Relation created',
  "关系已删除": 'Relation deleted',
  "布局已整理": 'Layout tidied',
  "至少要有两个条目": 'Need at least two entries',

  // 时间线
  "新事件": 'New event',
  "年代": 'Year',
  "编辑事件": 'Edit event',
  "事件已保存": 'Event saved',
  "事件已添加": 'Event added',
  "事件已删除": 'Event deleted',
  "标题不能为空": 'Title is required',
  "第年": 'Year',
  "前": 'BCE ',
  "个事件": 'events',
  "拖动卡片可改年份": 'drag a card to change its year',

  // 地图
  "选择": 'Select',
  "道路": 'Route',
  "擦除": 'Erase',
  "底图": 'Backdrop',
  "导出": 'Export',
  '导出 SVG': 'Export SVG',
  '拖动平移 · 滚轮缩放 · 双击编辑': 'Drag to pan · wheel to zoom · double-click to edit',
  '点击落点，双击或回车闭合；Esc 取消': 'Click to place points, double-click or Enter to close; Esc cancels',
  '点击连线，双击或回车结束；Esc 取消': 'Click to draw, double-click or Enter to finish; Esc cancels',
  "点击放一个地点": 'Click to place a pin',
  '点中要删除的区域 / 地点 / 道路': 'Click a region / pin / route to delete',
  "区域已创建，右下角可以改名和配色": 'Region created — rename and recolor in the panel',
  "至少三个点才能围成区域": 'Need at least 3 points',
  "至少两个点才能成线": 'Need at least 2 points',
  "放置地点": 'Place pin',
  "关联设定卡": 'Linked entry',
  '关联设定卡（可选）': 'Linked entry (optional)',
  "不关联": 'None',
  "规模": 'Size',
  "放置": 'Place',
  "颜色": 'Color',
  "顶点": 'Vertices',
  "删除区域": 'Delete region',
  "收起": 'Collapse',
  "编辑设定卡": 'Open entry',
  "地图底图": 'Map backdrop',
  "透明度": 'Opacity',
  "图库是空的": 'Gallery is empty',
  "先去「生图工坊」生成一张地图底图。": 'Generate a map backdrop in Images first.',
  "不用底图": 'No backdrop',
  "完成": 'Done',
  "新区域": 'New region',
  "新地点": 'New pin',
  'SVG 已导出': 'SVG exported',

  // 生图工坊
  "挂到哪个条目": 'Attach to entry',
  '不挂（只进图库）': 'None (gallery only)',
  "提示词": 'Prompt',
  "英文更稳，中文模型也能读": 'English works best',
  "按条目重写": 'Rewrite from entry',
  "套用世界风格": 'Apply world style',
  "反向词": 'Negative prompt',
  '留空使用默认（模糊/文字/水印…）': 'Leave empty for defaults',
  "尺寸": 'Size',
  "种子": 'Seed',
  "留空随机": 'Random',
  "生成": 'Generate',
  '生成中…': 'Generating…',
  '方形 1:1': 'Square 1:1',
  '横幅 3:2': 'Landscape 3:2',
  '竖幅 2:3': 'Portrait 2:3',
  '宽幅 16:9': 'Wide 16:9',
  '长幅 9:16': 'Tall 9:16',
  '头像 / 立绘 / 器物': 'Portrait / object',
  '城镇远景 / 场景': 'Townscape / scene',
  '人物全身 / 高塔': 'Full body / tower',
  '地图底图 / 全景': 'Map backdrop / panorama',
  "竖版海报": 'Vertical poster',
  "挂到": 'Attach to',
  "未选条目": 'no entry',
  "设为地图底图": 'Use as map backdrop',
  "下载": 'Download',
  "复制提示词": 'Copy prompt',
  "图库": 'Gallery',
  "还没有图": 'No images yet',
  "写个提示词，点上面的「生成」。": 'Write a prompt and hit Generate.',
  "重测": 'Recheck',
  "检测中…": 'Checking…',
  'ComfyUI 在线': 'ComfyUI online',
  'ComfyUI 未启动': 'ComfyUI offline',
  "智谱已配置": 'Zhipu configured',
  "智谱还没填 Key": 'Zhipu key missing',
  "先写提示词": 'Write a prompt first',
  "先选一个条目，或者直接手写提示词": 'Pick an entry, or just write a prompt',
  '世界风格还是空的，去「设置」里填一句': 'World style is empty — fill it in Settings',
  "已经套过了": 'Already applied',
  "已设为地图底图": 'Set as map backdrop',
  "提示词已复制": 'Prompt copied',
  "已挂上": 'Attached',
  "这张图已经挂在这个条目上了": 'Already attached to this entry',
  '出图了': 'Done',
  "生成失败": 'Generation failed',

  // 设定卡编辑器
  '编辑 · {}': 'Edit · {}',
  "新设定卡": 'New entry',
  '别名（逗号分隔）': 'Aliases (comma separated)',
  '标签（逗号分隔）': 'Tags (comma separated)',
  "空行分段，支持加粗": 'blank line for new paragraph',
  'AI 扩写这段': 'AI expand this',
  "思考中…": 'Thinking…',
  "结构化字段": 'Fields',
  "加一行": 'Add field',
  "还没有关系。可以在这里连，也可以在「关系图」里拖出来。":
    'No relations yet. Add one here, or drag in Graph.',
  '选择另一个条目…': 'Pick another entry…',
  '＋ 连一条': 'Link one',
  "切换方向": 'Swap direction',
  "还没有配图。到「生图工坊」按这个条目生成，会自动挂回来。":
    'No images yet. Generate one in Images; it will attach here.',
  "去生图工坊": 'Open Images',
  "创建于": 'Created',
  "出现在": 'appears in',
  "个事件里": 'events',
  "被": 'referenced by',
  "条关系指向": 'relations',
  "删除设定卡": 'Delete entry',
  "已追加，记得保存": 'Appended — remember to save',
  "已创建": 'Created',
  "已保存": 'Saved',
  "名称不能为空": 'Name is required',
  "身份": 'Role',

  // 导入整理
  "导入整理": 'Import & organize',
  '把 txt / md 拖进来，或点这里选文件': 'Drop txt / md here, or click to pick files',
  "一个设定一个文件、或者一整篇大文档都可以": 'One entry per file, or one big document',
  '或者直接粘贴（一整个文档也行）': 'Or paste text (a whole document works)',
  '把设定正文粘进来，标题行、空行分段都能识别…': 'Paste your text — headings and blank lines are detected',
  "处理方式": 'Mode',
  '纯规则切分（离线）': 'Rules only (offline)',
  '规则 + AI 提炼': 'Rules + AI',
  "切分依据": 'Split by',
  "自动判断": 'Auto',
  "自动分块": 'Auto chunking',
  "每个文件一条": 'One per file',
  '按 # 标题': 'By # headings',
  "按空行分段": 'By blank lines',
  "整篇作为一条": 'Whole document',
  "解析": 'Parse',
  "解析中…": 'Parsing…',
  "全选": 'Select all',
  "全不选": 'Clear',
  "批量设为": 'Set all to',
  "导入": 'Import',
  "推断关系": 'Infer relations',
  '推断中…': 'Inferring…',
  "推断出的关系": 'Inferred relations',
  "还没有解析": 'Nothing parsed yet',
  "已选": 'selected',
  "粘贴文本": 'pasted text',
  "个字段": 'fields',
  'AI 解析中': 'AI parsing',
  'AI 没抽出东西，已退回规则切分': 'AI returned nothing — fell back to rules',
  "先拖文件或粘一段文本": 'Drop a file or paste text first',
  "没有可导入的条目": 'Nothing to import',
  "至少选两条": 'Select at least two',
  "没切出条目": 'Nothing split out',
  "换个切分方式，或者检查文本里有没有标题行。": 'Try another split mode, or check for heading lines.',
  "去掉这条": 'Remove',
  '规则模式：按标题 / 独立短行 / 空行切，全程本地，不花额度。':
    'Rules mode: splits by headings, standalone short lines or blank lines. Fully local.',
  'AI 模式会分块调用模型；接口没填 key 时会退回规则切分。':
    'AI mode calls the model chunk by chunk; falls back to rules if no key is set.',

  // 其它
  "这个视图出错了": 'This view crashed',
  "连不上 WorldForge 后端": 'Cannot reach the WorldForge backend',
  "确认 server.mjs 还在跑": 'Check that server.mjs is still running',
  "读取数据失败：": 'Failed to read data: ',
  "读取世界列表失败：": 'Failed to read world list: ',
  "保存失败：": 'Save failed: ',
  '撤销 (Ctrl+Z)': 'Undo (Ctrl+Z)',
  "自动保存状态": 'Autosave status',
  '点击切换配色；到「设置 → 外观」可自定义强调色': 'Switch theme — customize the accent in Settings → Appearance',
  '＋ 新设定': '＋ New entry',
  '＋ 新条目': '＋ New entry',
  '＋ 新建': '＋ New',
  '＋ 加一行': '＋ Add field',
  "正文": 'Body',
  '— 空行分段，支持加粗': '— blank line for a new paragraph',
  '本地 ComfyUI 或云端智谱 · 出图后可以一键挂回设定卡或当地图底图':
    'Local ComfyUI or cloud Zhipu · attach results to entries or use as a map backdrop',
  'ComfyUI 未启动': 'ComfyUI offline',
  "张": 'images'
};

/** 带数字、需要组装的句子（只在代码里显式调用 t() 时生效） */
const PATTERNS = [
  [/^(\d+) 张卡$/, (m, n) => `${n} cards`],
  [/^(\d+) 条结果$/, (m, n) => `${n} results`],
  [/^(\d+) 条设定$/, (m, n) => `${n} entries`],
  [/^(\d+) 个事件$/, (m, n) => `${n} events`],
  [/^(\d+) 条关系$/, (m, n) => `${n} relations`],
  [/^(\d+) 个世界 · (\d+) 条设定$/, (m, a, b) => `${a} worlds · ${b} entries`],
  [/^(\d+) 个区域$/, (m, n) => `${n} regions`],
  [/^(\d+) 个地点$/, (m, n) => `${n} pins`],
  [/^(\d+) 条路线$/, (m, n) => `${n} routes`],
  [/^第 (-?\d+) 年$/, (m, n) => `Year ${n}`],
  [/^前 (-?\d+) 年$/, (m, n) => `${-n} BCE`]
];

let lang = 'zh';
let observer = null;
let scheduled = false;

export function getLang() {
  return lang;
}

export function initLang() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    saved = null;
  }
  lang = saved === 'en' ? 'en' : 'zh';
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  return lang;
}

export function setLang(next) {
  lang = next === 'en' ? 'en' : 'zh';
  try {
    localStorage.setItem(STORAGE_KEY, next === 'en' ? 'en' : 'zh');
  } catch {
    /* 隐私模式下写不进去也没关系 */
  }
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
}

/** 显式翻译（支持 {name} 占位） */
export function t(text, vars) {
  if (text == null) return '';
  let out = String(text);
  if (lang === 'en') {
    if (Object.prototype.hasOwnProperty.call(EN, out)) out = EN[out];
    else {
      for (const [re, fn] of PATTERNS) {
        const mm = out.match(re);
        if (mm) {
          out = fn(...mm);
          break;
        }
      }
    }
  }
  if (vars && typeof vars === 'object') {
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

/** 只做精确查表，绝不套正则 —— 避免误改用户正文 */
function phrase(text) {
  if (!text || !CJK.test(text)) return text;
  return Object.prototype.hasOwnProperty.call(EN, text) ? EN[text] : text;
}

const ATTRS = ['placeholder', 'title', 'aria-label'];

function walkNode(node) {
  if (!node) return;
  if (node.nodeType === Node.TEXT_NODE) {
    const raw = node.nodeValue;
    const trimmed = raw.trim();
    if (!trimmed || !CJK.test(trimmed)) return;
    const next = phrase(trimmed);
    if (next !== trimmed) node.nodeValue = raw.replace(trimmed, next);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  if (['SCRIPT', 'STYLE'].includes(node.tagName)) return;
  for (const attr of ATTRS) {
    const v = node.getAttribute(attr);
    if (v && CJK.test(v)) {
      const next = phrase(v.trim());
      if (next !== v.trim()) node.setAttribute(attr, next);
    }
  }
  for (const child of [...node.childNodes]) walkNode(child);
}

/** 把一棵子树里的界面文字换成当前语言（幂等） */
export function localizeDom(root = document.body) {
  if (lang !== 'en' || !root) return;
  walkNode(root);
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    localizeDom(document.body);
  });
}

/** 视图每次重渲染都会改 DOM，这里盯着自动补翻 */
export function bootLocalizer() {
  if (observer) return;
  observer = new MutationObserver(() => schedule());
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule();
}

export function applyStaticText(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const attr = el.getAttribute('data-i18n-attr');
    if (attr) el.setAttribute(attr, t(key));
    else el.textContent = t(key);
  });
}

export const LANGS = [
  { id: 'zh', label: '简体中文' },
  { id: 'en', label: 'English' }
];

export function langLabel(id) {
  return LANGS.find((l) => l.id === id)?.label || id;
}
