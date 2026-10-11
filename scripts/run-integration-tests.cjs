const { existsSync, readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const envFile = resolve(root, '.env.test');
if (!existsSync(envFile)) {
  console.error('Missing .env.test. Copy .env.test.example and keep the database name suffixed with _test.');
  process.exit(1);
}

for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
}

const url = process.env.DATABASE_URL || '';
let parsedUrl;
try { parsedUrl = new URL(url); } catch { parsedUrl = null; }
if (
  process.env.NODE_ENV !== 'test' ||
  !parsedUrl ||
  parsedUrl.protocol !== 'mysql:' ||
  parsedUrl.hostname !== 'localhost' ||
  parsedUrl.port !== '3308' ||
  parsedUrl.pathname !== '/casa_test'
) {
  console.error('Refusing destructive integration tests: require NODE_ENV=test and DATABASE_URL=mysql://...@localhost:3308/casa_test.');
  process.exit(1);
}

for (const [script, args] of [
  [resolve(root, 'node_modules/prisma/build/index.js'), ['migrate', 'deploy']],
  [resolve(root, 'node_modules/vitest/vitest.mjs'), ['run', 'test/integration', '--maxWorkers=1', ...process.argv.slice(2)]],
]) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, env: process.env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
