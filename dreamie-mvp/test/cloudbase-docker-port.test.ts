import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('sets the CloudBase service port inside the production image', () => {
  const dockerfile = readFileSync(resolve(process.cwd(), '..', 'Dockerfile'), 'utf8');

  assert.match(dockerfile, /^ENV PORT=8080$/m);
  assert.match(dockerfile, /^COPY index\.html app\.js audio-player\.js styles\.css package\.json \.\/$/m);
});
