import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadRelease, PLUGINS, portablePath, validateManifest } from '../src/manifest.mjs';
import { resolveHome } from '../src/runtime.mjs';
import { fixture, installerFixture } from './fixtures.mjs';

test('release validates all nine archive hashes and rejects modified bytes', async t => {
  const f = await installerFixture(t);
  assert.equal((await loadRelease(f.manifest)).plugins.length, 9);
  await writeFile(join(f.release, f.plugins[0].archive), 'modified archive');
  await assert.rejects(loadRelease(f.manifest), /SHA-256 mismatch/u);
});

test('default recipe has nine plugins and all recipes require unique legal names', () => {
  const plugins = PLUGINS.map(name => ({ name, version: '1.0.0', source: `vendor/${name}` }));
  assert.equal(validateManifest({ schemaVersion: 1, plugins }, 'source').plugins.length, 9);
  assert.throws(() => validateManifest({ schemaVersion: 1, plugins: [plugins[0], ...plugins.slice(0, 8)] }, 'source'), /unique npm/u);
  assert.throws(() => validateManifest({ schemaVersion: 2, plugins }, 'source'), /schemaVersion/u);
  assert.throws(() => validateManifest({ schemaVersion: 1, plugins: [] }, 'source'), /nonempty/u);
  for (const name of ['../escape', '@bad', 'Uppercase', 'name:stream', 'node_modules', '@scope/../../escape']) {
    assert.throws(() => validateManifest({ schemaVersion: 1, plugins: [{ ...plugins[0], name }] }, 'source'), /unique npm/u);
  }
  assert.equal(validateManifest({ schemaVersion: 1, plugins: [{ name: '@custom/single-plugin', version: '2.1.0',
    url: 'https://example.test/single-2.1.0.tgz', sha256: 'a'.repeat(64) }] }).plugins.length, 1);
});

test('portable paths reject traversal, Windows drives/devices and alternate streams', () => {
  for (const path of ['../escape', '/absolute', 'C:/data.tgz', 'a\\b', 'a/../b', 'a/./b', 'a//b',
    'a/file:stream', 'a/CON.txt', 'a/NUL', 'a/name.', 'a/name ', 'a/*', 'a/\u0000']) {
    assert.throws(() => portablePath(path), /Unsafe manifest path/u, path);
  }
  assert.equal(portablePath('artifacts/插件-1.0.0.tgz'), 'artifacts/插件-1.0.0.tgz');
});

test('archive directory junction cannot escape the release', async t => {
  const f = await installerFixture(t);
  const { rename, readFile } = await import('node:fs/promises');
  const outside = join(f.root, 'outside');
  await rename(join(f.release, 'artifacts'), outside);
  await symlink(outside, join(f.release, 'artifacts'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(loadRelease(f.manifest), /escapes/u);
  assert.ok(await readFile(join(outside, `${PLUGINS[0]}-1.0.0.tgz`)));
});

test('Next home protects upstream roots, ancestors and junction aliases', async t => {
  const root = await fixture(t);
  const user = join(root, 'user');
  const app = join(root, 'app');
  await mkdir(join(user, '.dsh'), { recursive: true });
  await mkdir(app);
  assert.equal(await resolveHome(undefined, app, {}, user), join(user, '.dsh-next'));
  assert.equal(await resolveHome(undefined, app, {}, user, 'original'), join(user, '.dsh'));
  await assert.rejects(resolveHome(join(user, '.dsh-next'), app, {}, user, 'original'), /protected/u);
  await assert.rejects(resolveHome(join(root, 'custom-next', 'nested'), app, { DSH_NEXT_HOME: join(root, 'custom-next') }, user, 'original'), /protected/u);
  for (const target of [user, join(user, '.dsh'), join(user, '.dsh', 'nested'), app, root]) {
    await assert.rejects(resolveHome(target, app, {}, user), /protected/u);
  }
  await symlink(join(user, '.dsh'), join(user, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(resolveHome(join(user, 'alias'), app, {}, user), /protected/u);
  await assert.rejects(resolveHome('relative', app, {}, user), /absolute/u);
  await assert.rejects(resolveHome(join(root, 'upstream', 'child'), app, { DSH_HOME: join(root, 'upstream') }, user), /protected/u);
});
