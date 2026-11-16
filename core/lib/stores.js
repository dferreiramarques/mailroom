// Onde o módulo guarda rascunhos e definições. A plataforma pode passar
// o seu próprio adaptador (base de dados, por tenant, etc.) com a mesma forma.
import fs from 'node:fs';
import path from 'node:path';

export function memoryStore(initial = {}) {
  let drafts = initial.drafts || [];
  let settings = initial.settings || {};
  return {
    getDrafts: async () => drafts,
    setDrafts: async (d) => { drafts = d; },
    getSettings: async () => settings,
    setSettings: async (s) => { settings = s; },
  };
}

export function fileStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return d; } };
  const write = (f, v) => fs.writeFileSync(path.join(dir, f), JSON.stringify(v, null, 2));
  return {
    getDrafts: async () => read('drafts.json', []),
    setDrafts: async (d) => write('drafts.json', d),
    getSettings: async () => read('settings.json', {}),
    setSettings: async (s) => write('settings.json', s),
  };
}
