#!/usr/bin/env node
/**
 * 假的 ComfyUI：只为验证 WorldForge 的对接协议（/prompt → /history → /view）。
 * 会把收到的 workflow 写到 fake-comfy-last.json，方便检查宽高、步数、种子。
 *
 * 用法：node tools/fake-comfy.mjs [--port 8199]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 8199;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const jobs = new Map();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, obj) => {
    const body = Buffer.from(JSON.stringify(obj));
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length });
    res.end(body);
  };

  if (url.pathname === '/system_stats') {
    return send(200, { system: { os: 'fake', comfyui_version: 'mock' }, devices: [{ name: 'mock-gpu', vram_total: 1 }] });
  }
  if (url.pathname === '/object_info/CheckpointLoaderSimple') {
    return send(200, {
      CheckpointLoaderSimple: {
        input: { required: { ckpt_name: [['sd_xl_base_1.0.safetensors', 'animagine-xl-4.0.safetensors']] } }
      }
    });
  }
  if (url.pathname === '/prompt' && req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const id = `job-${Date.now()}`;
    jobs.set(id, body.prompt);
    fs.writeFileSync(path.join(process.cwd(), 'fake-comfy-last.json'), JSON.stringify(body.prompt, null, 2));
    return send(200, { prompt_id: id, number: 1 });
  }
  if (url.pathname.startsWith('/history/')) {
    const id = url.pathname.split('/').pop();
    if (!jobs.has(id)) return send(200, {});
    return send(200, {
      [id]: {
        status: { status_str: 'success', completed: true },
        outputs: { 7: { images: [{ filename: `${id}.png`, subfolder: '', type: 'output' }] } }
      }
    });
  }
  if (url.pathname === '/view') {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length });
    return res.end(PNG);
  }
  send(404, { error: 'not found' });
});

server.listen(port, '127.0.0.1', () => console.log(`fake-comfy listening on ${port}`));
