#!/usr/bin/env node
/**
 * 无头浏览器探针：用 CDP 打开某个 URL，等渲染完，读回
 *   - body.dataset.errors（页面自检的未捕获错误）
 *   - 可见文本片段
 *   - 指定选择器是否存在
 *
 * 用法：node tools/probe.mjs "http://127.0.0.1:7317/#/cards" "#card-grid" "空湾"
 * 依赖：本机已有一个带 --remote-debugging-port=9222 的 Edge/Chrome
 */
const url = process.argv[2];
const checks = process.argv.slice(3);
const ENDPOINT = process.env.CDP || 'http://127.0.0.1:9222';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  const res = await fetch(`${ENDPOINT}/json/list`);
  return res.json();
}

async function openTab(targetUrl) {
  const res = await fetch(`${ENDPOINT}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`建标签页失败 HTTP ${res.status}`);
  return res.json();
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

async function main() {
  if (!url) throw new Error('缺少 URL');
  const existing = (await targets()).filter((t) => t.type === 'page');
  const tab = await openTab(url);
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  const send = rpc(ws);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(2200);

  const expr = `(() => {
    const errs = document.body?.dataset?.errors || '';
    const text = document.body?.innerText || '';
    return JSON.stringify({ ready: !!window.__WORLDFORGE_READY__, errors: errs, text: text.slice(0, 4000), title: document.title });
  })()`;
  const { result } = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  const data = JSON.parse(result.value);

  const out = { url, title: data.title, ready: data.ready, errors: data.errors, checks: {} };
  for (const c of checks) {
    if (c.startsWith('#')) {
      const { result: has } = await send('Runtime.evaluate', {
        expression: `!!document.querySelector(${JSON.stringify(c)})`,
        returnByValue: true
      });
      out.checks[c] = has.value;
    } else {
      out.checks[c] = data.text.includes(c);
    }
  }
  console.log(JSON.stringify(out, null, 2));
  ws.close();
  await fetch(`${ENDPOINT}/json/close/${tab.id}`);
}

main().catch((err) => {
  console.error('PROBE FAILED:', err.message);
  process.exit(1);
});
