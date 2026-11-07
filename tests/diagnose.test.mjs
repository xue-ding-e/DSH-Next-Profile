import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diagnose } from '../src/diagnose.mjs';
import { install } from '../src/install.mjs';
import { fakeRuntime, installerFixture, json } from './fixtures.mjs';

test('doctor can inspect a running host without fetching archives or requiring shutdown', async t => {
  const f = await installerFixture(t);
  const hooks = fakeRuntime(f);
  await install({ manifest: f.manifest, home: f.home }, hooks);
  await json(f.manifest, { schemaVersion: 1, plugins: f.plugins.map(({ name, version, sha256 }) => ({
    name, version, sha256, url: `https://example.invalid/${name}.tgz`,
  })) });
  const before = await readFile(join(f.profile, 'package.json'));
  const report = await diagnose({ manifest: f.manifest, home: f.home }, {
    runtime: f.runtime,
    request() { throw new Error('Unexpected network request'); },
    assertStopped() { throw new Error('Doctor must not require shutdown'); },
  });
  assert.equal(report.codeInstalled, true);
  assert.equal(report.rows.length, f.plugins.length);
  assert.equal(report.runtimeVerified, false);
  assert.equal(report.guiVerified, false);
  assert.ok(report.setup.some(item => item.package === 'dsh-bsk-bridge' && item.verified === false));
  assert.deepEqual(await readFile(join(f.profile, 'package.json')), before);
});

test('doctor reports a pristine profile without creating it and reports installed version drift', async t => {
  const f = await installerFixture(t);
  const absent = await diagnose({ manifest: f.manifest, home: join(f.root, 'not-started') }, { runtime: f.runtime });
  assert.equal(absent.initialized, false);
  assert.equal(absent.codeInstalled, false);
  const hooks = fakeRuntime(f);
  await install({ manifest: f.manifest, home: f.home }, hooks);
  await json(join(f.profile, 'node_modules', f.plugins[0].name, 'package.json'), {
    name: f.plugins[0].name, version: '9.9.9', main: 'lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } },
  });
  const report = await diagnose({ manifest: f.manifest, home: f.home }, { runtime: f.runtime });
  assert.equal(report.codeInstalled, false);
  assert.equal(report.rows[0].installedVersion, '9.9.9');
  assert.equal(report.rows[0].installed, false);
  await json(f.manifest, { schemaVersion: 1, plugins: f.plugins,
    baseline: { host: 'next', runtimeVersion: '9.9.9', applicationVersion: '9.9.9' } });
  assert.equal((await diagnose({ manifest: f.manifest, home: f.home }, { runtime: f.runtime })).baselineMatches, false);
});
