/**
 * Minimal host application — proves the whole system end to end.
 *
 *   node examples/demo-app.js
 */

import { createKernel } from '../src/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

const kernel = await createKernel({
  rootDir: path.join(dir, '..'),
  pluginDirs: [path.join(dir, 'plugins')],
  dataDir: path.join(dir, '..', '.uniplug'),
  logLevel: 'info',
  hotReload: true,
});

await kernel.start();

console.log('\n── plugins ───────────────────────────────');
for (const p of kernel.describe()) {
  console.log(`  ${p.id}@${p.version} — ${p.state}`);
}

console.log('\n── services ──────────────────────────────');
console.log(' ', kernel.services.names().join(', ') || '(none)');

console.log('\n── events ────────────────────────────────');
await kernel.emit('demo:message', { text: 'hello from the host' });

console.log('\n── hooks ─────────────────────────────────');
const transformed = await kernel.callHook('demo:transform', { text: 'hello from the host', steps: [] });
console.log('  result:', JSON.stringify(transformed));

console.log('\n── commands ──────────────────────────────');
for (const cmd of kernel.commandsList()) console.log(`  ${cmd.name} (${cmd.owner}) — ${cmd.description}`);
console.log('  ->', await kernel.runCommand('hello:greet', 'World'));

console.log('\n── stats ─────────────────────────────────');
console.log(kernel.stats());
console.log('\n── hot reload ────────────────────────────');
console.log('  hotReload is on — edit examples/plugins/lifecycle-audit/index.js to see a reload');
await new Promise((resolve) => setTimeout(resolve, 6000));

await kernel.stop();
console.log('\nkernel stopped.');
