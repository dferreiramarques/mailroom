// Verifica se há uma versão nova nas Releases do GitHub e, no executável, substitui-o.
import fs from 'node:fs';

const ASSET = { win32: 'mailroom-win-x64.exe', linux: 'mailroom-linux-x64' }[process.platform];
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0));
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

export function createUpdater({ repo, version, packaged, api = process.env.MAILROOM_UPDATE_API || 'https://api.github.com' }) {
  let cache = null;
  const exe = process.execPath;
  // Limpa restos de uma atualização anterior.
  if (packaged) for (const f of [exe + '.old', exe + '.new']) fs.promises.unlink(f).catch(() => {});

  async function check(fresh = false) {
    if (cache && !fresh && Date.now() - cache.at < 3600_000) return cache.value;
    const value = { current: version, latest: null, available: false, packaged, canApply: false, url: `https://github.com/${repo}/releases/latest` };
    try {
      const r = await fetch(`${api}/repos/${repo}/releases/latest`, { headers: { 'User-Agent': 'mailroom', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const rel = await r.json();
        const asset = (rel.assets || []).find((a) => a.name === ASSET);
        Object.assign(value, {
          latest: String(rel.tag_name || '').replace(/^v/, ''), url: rel.html_url || value.url, notes: String(rel.body || '').slice(0, 800),
          available: newer(rel.tag_name, version), _asset: asset ? { url: asset.browser_download_url, size: asset.size } : null,
        });
        value.canApply = Boolean(packaged && value.available && asset);
      } else if (r.status !== 404) value.error = `GitHub respondeu ${r.status}`;
    } catch (e) { value.error = 'Sem ligação ao GitHub'; }
    cache = { at: Date.now(), value };
    return value;
  }

  async function apply() {
    const info = await check(true);
    if (!info.canApply) throw Object.assign(new Error(packaged ? 'Não há atualização para aplicar' : 'Nesta instalação atualiza-se com: git pull && npm install'), { status: 400 });
    const tmp = exe + '.new', old = exe + '.old';
    const r = await fetch(info._asset.url, { headers: { 'User-Agent': 'mailroom' }, redirect: 'follow' });
    if (!r.ok) throw new Error(`Download falhou (${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (info._asset.size && buf.length !== info._asset.size) throw new Error('Download incompleto; tenta outra vez');
    await fs.promises.writeFile(tmp, buf, { mode: 0o755 });
    // Um executável em uso não pode ser reescrito, mas pode ser renomeado.
    await fs.promises.unlink(old).catch(() => {});
    await fs.promises.rename(exe, old);
    try { await fs.promises.rename(tmp, exe); }
    catch (e) { await fs.promises.rename(old, exe).catch(() => {}); throw new Error('Não consegui substituir o executável: ' + e.message); }
    cache = null;
    return { ok: true, version: info.latest, restart: true };
  }

  // O que vai para o browser (sem campos internos).
  return { check: async (fresh) => { const { _asset, ...pub } = await check(fresh); return pub; }, apply };
}
