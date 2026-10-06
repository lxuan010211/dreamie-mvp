import assert from 'node:assert/strict';
import test from 'node:test';

import { getLocalCertificateUrl, getLocalPreviewUrls } from '../src/web-server.js';

test('lists both HTTP and local HTTPS preview addresses', () => {
  assert.deepEqual(getLocalPreviewUrls('10.194.246.209'), {
    http: 'http://10.194.246.209:3000',
    https: 'https://10.194.246.209:3443',
  });
});

test('builds a local certificate download address', () => {
  assert.equal(getLocalCertificateUrl('10.194.246.209'), 'http://10.194.246.209:3000/dreamie-local-ca.crt');
});
