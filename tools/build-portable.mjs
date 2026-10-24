/**
 * 便携版：在发布包基础上塞进一份 node.exe，做成「解压双击即用」，不用装 Node。
 *
 * 产物：<TEMP>/wfportable/worldforge-portable/  —— 再用 Compress-Archive 压成 zip
 * 用法：node tools/build-portable.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { stageRelease } from './build-release.mjs';

const SRC_NODE = 'C:/Program Files/nodejs/node.exe';
const OUT_ROOT = path.join(process.env.TEMP, 'wfportable');
const OUT = path.join(OUT_ROOT, 'WorldForge');

const NOTICE = `WorldForge 便携版内置了 Node.js 运行时
=========================================

本目录下的 node/node.exe 是 Node.js 官方 Windows 版可执行文件，
按 MIT 协议随本程序一起分发，版权归 Node.js contributors 所有。

Node.js: https://nodejs.org
许可证:  https://github.com/nodejs/node/blob/main/LICENSE

除此之外的所有代码在本仓库下，同样以 MIT 协议发布。
`;

const START_BAT = `@echo off
chcp 65001 >nul
cd /d "%~dp0"
title WorldForge
color 0f

if not exist "%~dp0node\\node.exe" goto :nonode

for /f %%i in ('"%~dp0node\\node.exe" "%~dp0tools\\pick-port.cjs"') do set "PORT=%%i"
if "%PORT%"=="0" goto :noport

echo.
echo    WorldForge 世界观锻造炉
echo    ----------------------------------------
echo    地址： http://127.0.0.1:%PORT%
echo    关掉这个窗口 = 关掉服务（数据已实时写盘）
echo    ----------------------------------------
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 1500; Start-Process 'http://127.0.0.1:%PORT%/'"
"%~dp0node\\node.exe" "%~dp0server.mjs" --port %PORT%
echo.
echo   服务已停止。
pause
exit /b 0

:nonode
echo.
echo   [错误] 找不到 node\\node.exe
echo   请重新解压完整的便携版压缩包，不要只复制一部分文件。
echo.
pause
exit /b 1

:noport
echo.
echo   [错误] 7317-7326 端口都被占用了
echo   请关掉占用这些端口的程序，或者重启电脑后重试。
echo.
pause
exit /b 1
`;

async function main() {
  const stage = await stageRelease();

  await fs.rm(OUT_ROOT, { recursive: true, force: true });
  await fs.mkdir(OUT_ROOT, { recursive: true });
  await fs.cp(stage, OUT, { recursive: true });

  await fs.mkdir(path.join(OUT, 'node'), { recursive: true });
  await fs.copyFile(SRC_NODE, path.join(OUT, 'node', 'node.exe'));
  await fs.writeFile(path.join(OUT, 'node', 'NOTICE.txt'), NOTICE, 'utf8');

  await fs.writeFile(path.join(OUT, 'start.bat'), START_BAT.replace(/\r?\n/g, '\r\n'), 'utf8');
  await fs.writeFile(
    path.join(OUT, '使用说明.txt'),
    [
      'WorldForge 便携版',
      '================',
      '',
      '1. 把整个文件夹解压到任意位置（不要在压缩包里直接双击）',
      '2. 双击 start.bat',
      '3. 浏览器会自动打开；如果没打开，手动访问窗口里显示的地址',
      '4. 关掉那个黑色窗口就等于关掉程序，数据会实时保存',
      '',
      '不需要安装 Node.js —— 里面已经带了一份。',
      '',
      '数据在哪？',
      '  本文件夹下的 data\\worlds\\ —— 每个世界观一个 JSON 文件，拷走即备份。',
      '',
      '第一次打开会看到一个叫「灰潮纪元」的示例世界，随便删。',
      ''
    ].join('\r\n'),
    'utf8'
  );

  const exeSize = (await fs.stat(path.join(OUT, 'node', 'node.exe'))).size;
  console.log(`portable staged at: ${OUT}`);
  console.log(`bundled node.exe: ${(exeSize / 1024 / 1024).toFixed(1)} MB`);
}

await main();
