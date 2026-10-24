/**
 * 打包发布版：复制一份干净的 worldforge，只带示例世界，压成 zip 放桌面。
 * 会排除：用户自己的世界（data/worlds/*）、旧迁移文件、本地 config、导入备份、日志。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = 'D:/wd/deepseek-harness/default-workspace/worldforge';
const STAGE_ROOT = path.join(process.env.TEMP, 'wfdist');
const STAGE = path.join(STAGE_ROOT, 'worldforge');
const DEMO = path.join(SRC, 'data', 'demo-灰潮纪元.json');
const SHOTS = process.env.TEMP;

const COPY_FILES = ['server.mjs', 'start.bat', 'package.json', 'README.md', 'LICENSE', '.gitignore'];
const COPY_DIRS = ['public', 'tools'];

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function stageRelease() {
  await fs.rm(STAGE_ROOT, { recursive: true, force: true });
  await fs.mkdir(STAGE, { recursive: true });

  for (const f of COPY_FILES) {
    const from = path.join(SRC, f);
    if (await exists(from)) await fs.copyFile(from, path.join(STAGE, f));
  }
  for (const d of COPY_DIRS) {
    await fs.cp(path.join(SRC, d), path.join(STAGE, d), { recursive: true });
  }

  // 示例世界
  const demo = JSON.parse(await fs.readFile(DEMO, 'utf8'));
  demo.meta.title = '灰潮纪元';
  demo.meta.updatedAt = new Date().toISOString();
  await fs.mkdir(path.join(STAGE, 'data', 'worlds'), { recursive: true });
  await fs.writeFile(path.join(STAGE, 'data', 'worlds', 'w-demo.json'), JSON.stringify(demo, null, 2), 'utf8');
  await fs.writeFile(path.join(STAGE, 'data', 'state.json'), JSON.stringify({ active: 'w-demo' }, null, 2), 'utf8');

  // 示例图：改成稳定的名字，方便 .gitignore 用 demo-* 放行
  await fs.mkdir(path.join(STAGE, 'data', 'images'), { recursive: true });
  const IMG_RENAME = {
    '2026-10-24T14-56-41-020Z-80cf6d.png': 'demo-hollowbay-harbour.png',
    '2026-10-24T14-57-15-174Z-f6cdc5.png': 'demo-greywall-alley.png',
    '2026-10-24T14-57-35-821Z-dd5f49.png': 'demo-map-texture.png'
  };
  const rename = (f) => IMG_RENAME[f] || f;
  for (const e of demo.entities) e.images = (e.images || []).map(rename);
  for (const g of demo.gallery) g.file = rename(g.file);
  if (demo.map?.bg) demo.map.bg = rename(demo.map.bg);
  await fs.writeFile(path.join(STAGE, 'data', 'worlds', 'w-demo.json'), JSON.stringify(demo, null, 2), 'utf8');

  const usedImages = new Set([...demo.entities.flatMap((e) => e.images || []), ...demo.gallery.map((g) => g.file)]);
  for (const file of usedImages) {
    if (!file) continue;
    const origin = Object.entries(IMG_RENAME).find(([, to]) => to === file)?.[0] || file;
    const from = path.join(SRC, 'data', 'images', origin);
    if (await exists(from)) await fs.copyFile(from, path.join(STAGE, 'data', 'images', file));
  }

  // 发布版专用的 .gitignore：只放行示例世界与示例图
  await fs.writeFile(
    path.join(STAGE, '.gitignore'),
    [
      'node_modules/',
      '',
      '# 自己的世界不进仓库，只留示例',
      'data/worlds/*',
      '!data/worlds/w-demo.json',
      'data/images/*',
      '!data/images/demo-*.png',
      '',
      '# 本机配置与备份',
      'data/state.json',
      'data/config.json',
      'data/*.migrated',
      '',
      '# 系统垃圾',
      '*.log',
      '.DS_Store',
      'Thumbs.db',
      ''
    ].join('\n'),
    'utf8'
  );

  // 文档截图
  await fs.mkdir(path.join(STAGE, 'assets'), { recursive: true });
  const shots = {
    'wf-doc-overview.png': 'screen-overview.png',
    'wf-doc-cards.png': 'screen-cards.png',
    'wf-doc-graph.png': 'screen-graph.png',
    'wf-doc-map.png': 'screen-map.png'
  };
  for (const [from, to] of Object.entries(shots)) {
    const p = path.join(SHOTS, from);
    if (await exists(p)) await fs.copyFile(p, path.join(STAGE, 'assets', to));
  }
  // 仓库里 assets 下的截图本身就是示例世界的，整目录带走（README 中英两版都引用）
  for (const f of await fs.readdir(path.join(SRC, 'assets'))) {
    if (!/\.(png|ico|svg)$/i.test(f)) continue;
    const from = path.join(SRC, 'assets', f);
    if (await exists(from)) await fs.copyFile(from, path.join(STAGE, 'assets', f));
  }

  // 清掉开发期残留
  for (const junk of ['server.out.log', 'server.err.log', 'fake-comfy-last.json']) {
    await fs.rm(path.join(STAGE, junk), { force: true });
  }

  const list = [];
  async function walk(dir, prefix = '') {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = path.join(prefix, e.name);
      if (e.isDirectory()) await walk(path.join(dir, e.name), rel);
      else {
        const st = await fs.stat(path.join(dir, e.name));
        list.push([rel, st.size]);
      }
    }
  }
  await walk(STAGE);
  const total = list.reduce((a, [, s]) => a + s, 0);
  console.log(`staged ${list.length} files, ${(total / 1024 / 1024).toFixed(1)} MB`);
  for (const [rel, size] of list.sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${(size / 1024).toFixed(0).padStart(6)} KB  ${rel}`);
  }
  return STAGE;
}

export { stageRelease };

// 只有直接运行时才打包；被 build-portable 引入时不自动执行
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await stageRelease();
}
