import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { archiveUrl, downloadArchive } from '../src/archives.mjs';
import { loadRelease, validateManifest } from '../src/manifest.mjs';
import { installerFixture, json } from './fixtures.mjs';

test('locked URLs are public HTTPS tgz files without embedded credentials', () => {
  for (const url of ['http://example.test/file.tgz', 'ftp://example.test/file.tgz',
    'https://example.test/file.tgz?token=private', 'https://example.test/file.zip', 'file:///data.tgz']) {
    assert.throws(() => archiveUrl(url));
  }
  assert.equal(archiveUrl('https://example.test/a.tgz'), 'https://example.test/a.tgz');
  const authenticated = new URL('https://example.test/file.tgz');
  authenticated.username = 'synthetic-user';
  assert.throws(() => archiveUrl(authenticated.href), /credentials/u);
});

test('remote downloads verify hashes, omit credentials and reject insecure redirects', async () => {
  const bytes = Buffer.from('synthetic archive bytes');
  const plugin = { name: 'test-plugin', url: 'https://example.test/a.tgz', sha256: createHash('sha256').update(bytes).digest('hex') };
  const request = async (url, options) => {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.Authorization, undefined);
    return new Response(bytes);
  };
  assert.deepEqual(await downloadArchive(plugin, request), bytes);
  await assert.rejects(downloadArchive({ ...plugin, sha256: '0'.repeat(64) }, request), /SHA-256 mismatch/u);
  await assert.rejects(downloadArchive(plugin, async () => new Response(null, { status: 302, headers: { location: 'http://example.test/a.tgz' } })), /HTTPS/u);
  await assert.rejects(downloadArchive(plugin, async () => new Response(null, { status: 403 })), /403/u);
});

test('thin manifests download locked archives without writing transient source paths', async t => {
  const f = await installerFixture(t);
  const bodies = new Map();
  const plugins = [];
  for (const plugin of f.plugins) {
    const bytes = await readFile(join(f.release, plugin.archive));
    const url = `https://example.test/${plugin.name}.tgz`;
    bodies.set(url, bytes);
    plugins.push({ name: plugin.name, version: plugin.version, url, sha256: plugin.sha256 });
  }
  validateManifest({ schemaVersion: 1, plugins }, 'source');
  await json(f.manifest, { schemaVersion: 1, plugins });
  const release = await loadRelease(f.manifest, async url => new Response(bodies.get(url)));
  assert.equal(release.plugins.length, 9);
  assert.ok(release.plugins.every(plugin => plugin.archiveBytes && !plugin.archivePath));
});
