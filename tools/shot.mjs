#!/usr/bin/env node
/**
 * 截图工具：CDP 打开页面，设好视口，等渲染完，存 PNG。
 * 用法：node tools/shot.mjs <out.png> <url> [宽] [高] [等待ms]
 * 前提：本机有 --remote-debugging-port=9222 的 Edge/Chrome
 */
import fs from 'node:fs/promises';

const [out, url, w = '1600', h = '1000', wait = '2500'] = process.argv.slice(2);
const ENDPOINT = process.env.CDP || 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!out || !url) {
  console.error('用法: node tools/shot.mjs <out.png> <url> [w] [h] [waitMs]');
  process.exit(1);
}

function rpc(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const myId = ++id;
      pending.set(myId, { resolve, reject });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
}

const tab = await (await fetch(`${ENDPOINT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', rej);
});
const send = rpc(ws);
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(w),
  height: Number(h),
  deviceScaleFactor: 1,
  mobile: false
});
await send('Page.navigate', { url });
await sleep(Number(wait));
const shot = await send('Page.captureScreenshot', { format: 'png' });
await fs.writeFile(out, Buffer.from(shot.data, 'base64'));
const { result } = await send('Runtime.evaluate', {
  expression: `JSON.stringify({ errors: document.body?.dataset?.errors || '', ready: !!window.__WORLDFORGE_READY__ })`,
  returnByValue: true
});
console.log(result.value);
ws.close();
await fetch(`${ENDPOINT}/json/close/${tab.id}`);
