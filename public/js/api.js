/** 后端接口封装 */

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || data?.detail || `HTTP ${res.status}`);
  }
  return data;
}

export const api = {
  async getConfig() {
    return (await jsonFetch('/api/config')).config;
  },
  async saveConfig(patch) {
    return (
      await jsonFetch('/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch)
      })
    ).config;
  },
  async probeImages() {
    return jsonFetch('/api/images/probe');
  },
  async generateImage(payload) {
    return jsonFetch('/api/images/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  },
  async ai(task, payload) {
    return (await jsonFetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task, ...payload })
    })).text;
  }
};
