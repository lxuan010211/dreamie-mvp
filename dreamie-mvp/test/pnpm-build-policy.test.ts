import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('explicitly allows esbuild to run its required install script in production images', () => {
  const policy = readFileSync(resolve(process.cwd(), 'pnpm-workspace.yaml'), 'utf8');

  assert.match(policy, /^allowBuilds:\n\s+esbuild: true\s*$/m);
});
