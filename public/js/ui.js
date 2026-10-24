/** 通用 UI 工具：转义、DOM、弹窗、toast、下载 */

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function toast(message, kind = 'info', ms = 2600) {
  const host = document.getElementById('toast-host');
  const node = el(`<div class="toast ${kind === 'err' ? 'err' : ''}">${esc(message)}</div>`);
  host.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 260);
  }, ms);
}

/* ---------- 弹窗 ---------- */

let currentModal = null;

/**
 * openModal({ title, body, footer, narrow, onClose })
 * body: HTML 字符串或元素；返回 { root, close, setBody }
 */
export function openModal({ title, body = '', footer = '', narrow = false, onClose = null, dismissable = true }) {
  closeModal();
  const host = document.getElementById('modal-host');
  host.hidden = false;
  host.innerHTML = `
    <div class="modal ${narrow ? 'narrow' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="btn ghost small" data-close aria-label="关闭">✕</button>
      </div>
      <div class="modal-body"></div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  const modal = host.firstElementChild;
  const bodyHost = modal.querySelector('.modal-body');
  if (typeof body === 'string') bodyHost.innerHTML = body;
  else bodyHost.appendChild(body);

  const close = () => {
    if (!currentModal) return;
    host.hidden = true;
    host.innerHTML = '';
    currentModal = null;
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
  };
  function onKey(e) {
    if (e.key === 'Escape' && dismissable) {
      e.stopPropagation();
      close();
    }
  }
  document.addEventListener('keydown', onKey, true);
  modal.querySelector('[data-close]').addEventListener('click', close);
  host.onclick = (e) => {
    if (e.target === host && dismissable) close();
  };
  currentModal = { close };
  return {
    root: modal,
    body: bodyHost,
    close,
    setBody(html) {
      if (typeof html === 'string') bodyHost.innerHTML = html;
      else {
        bodyHost.innerHTML = '';
        bodyHost.appendChild(html);
      }
    }
  };
}

export function closeModal() {
  if (currentModal) currentModal.close();
}

export function modalOpen() {
  return Boolean(currentModal);
}

/** 确认框，返回 Promise<boolean> */
export function confirmDialog({ title = '确认', message = '', confirmText = '确定', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const m = openModal({
      title,
      narrow: true,
      body: `<p class="muted" style="margin:0;line-height:1.7">${esc(message)}</p>`,
      footer: `<span class="spacer"></span>
        <button class="btn" data-no>取消</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(confirmText)}</button>`,
      onClose: () => settled || resolve(false)
    });
    m.root.querySelector('[data-no]').onclick = () => {
      settled = true;
      m.close();
      resolve(false);
    };
    m.root.querySelector('[data-yes]').onclick = () => {
      settled = true;
      m.close();
      resolve(true);
    };
  });
}

/** 单行输入框，返回 Promise<string|null> */
export function promptDialog({ title = '输入', label = '', value = '', placeholder = '' }) {
  return new Promise((resolve) => {
    let settled = false;
    const m = openModal({
      title,
      narrow: true,
      body: `<div class="field"><label>${esc(label)}</label>
        <input type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" data-input /></div>`,
      footer: `<span class="spacer"></span>
        <button class="btn" data-no>取消</button>
        <button class="btn primary" data-yes>确定</button>`,
      onClose: () => settled || resolve(null)
    });
    const input = m.root.querySelector('[data-input]');
    input.focus();
    input.select();
    const done = () => {
      settled = true;
      const v = input.value.trim();
      m.close();
      resolve(v || null);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done();
    });
    m.root.querySelector('[data-no]').onclick = () => {
      settled = true;
      m.close();
      resolve(null);
    };
    m.root.querySelector('[data-yes]').onclick = done;
  });
}

/* ---------- 文件 ---------- */

export function download(filename, content, mime = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function pickFile(accept = '.json') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result) });
      reader.readAsText(file);
    };
    input.click();
  });
}

/** 极简 Markdown → HTML（只处理段落、加粗、斜体、行内代码） */
export function inlineMd(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => {
      let s = esc(p.trim()).replace(/\n/g, '<br>');
      s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      return `<p>${s}</p>`;
    })
    .join('');
}
