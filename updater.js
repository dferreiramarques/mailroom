// Verifica se há uma versão nova nas Releases do GitHub.
// (Na app de desktop, quem trata das atualizações é o electron-updater: ver electron/main.js.)
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0));
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

export function createUpdater({ repo, version, api = process.env.MAILROOM_UPDATE_API || 'https://api.github.com' }) {
  let cache = null;
  async function check(fresh = false) {
    if (cache && !fresh && Date.now() - cache.at < 3600_000) return cache.value;
    const value = { current: version, latest: null, available: false, packaged: false, canApply: false, url: `https://github.com/${repo}/releases/latest` };
    try {
      const r = await fetch(`${api}/repos/${repo}/releases/latest`, { headers: { 'User-Agent': 'mailroom', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const rel = await r.json();
        Object.assign(value, { latest: String(rel.tag_name || '').replace(/^v/, ''), url: rel.html_url || value.url, notes: String(rel.body || '').slice(0, 800), available: newer(rel.tag_name, version) });
      } else if (r.status !== 404) value.error = `GitHub respondeu ${r.status}`;
    } catch { value.error = 'Sem ligação ao GitHub'; }
    cache = { at: Date.now(), value };
    return value;
  }
  const apply = async () => { throw Object.assign(new Error('Nesta instalação atualiza-se com: git pull && npm install'), { status: 400 }); };
  return { check, apply };
}
