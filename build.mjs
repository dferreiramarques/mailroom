// Gera os executáveis em dist/:  node build.mjs [win] [linux]
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const targets = { win: ['node22-win-x64', 'mailroom-win-x64.exe'], linux: ['node22-linux-x64', 'mailroom-linux-x64'] };
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['win'];

fs.rmSync('build', { recursive: true, force: true });
await build({
  entryPoints: ['server.js'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'build/server.cjs',
  define: { 'import.meta.url': '__importMetaUrl', __MAILROOM_VERSION__: JSON.stringify(version) },
  banner: { js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;" },
  logLevel: 'warning',
});
fs.cpSync('core/client', 'build/client', { recursive: true });
fs.cpSync('public', 'build/public', { recursive: true });
fs.writeFileSync('build/package.json', JSON.stringify({ name: 'mailroom', version, bin: 'server.cjs', pkg: { assets: ['client/**/*', 'public/**/*'] } }, null, 2));

fs.mkdirSync('dist', { recursive: true });
for (const t of wanted) {
  const [target, out] = targets[t] || [];
  if (!target) throw new Error(`Alvo desconhecido: ${t}`);
  execFileSync('npx', ['pkg', 'build/package.json', '--targets', target, '--output', `dist/${out}`, '--no-bytecode', '--public-packages', '*', '--public'], { stdio: 'inherit' });
  console.log(`✓ dist/${out} (v${version})`);
}
