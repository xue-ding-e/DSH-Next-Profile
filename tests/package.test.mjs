import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildRelease } from '../scripts/build-release.mjs';
import { assertPublicFile, npm, pnpm, releaseMetadata, unpackLockedArchive } from '../scripts/pack-tools.mjs';
import { smokePackage, validatePackageFiles } from '../scripts/smoke-package.mjs';
import { loadRelease } from '../src/manifest.mjs';
import { execute } from '../src/process.mjs';
import { assertNoSecrets, privateDenyValues } from '../scripts/release-safety.mjs';
import { buildFixture, fixture, json } from './fixtures.mjs';

test('plugin metadata removes build hooks and retains runtime dependencies', () => {
  const actual = releaseMetadata({ name: 'example', license: 'MIT', scripts: { prepare: 'compile' }, private: true,
    devDependencies: { compiler: '1' }, dependencies: { undici: '^7' }, peerDependencies: { react: '>=18', '@deepseek-ai/cordis': '~4.0.5' } });
  assert.equal(actual.scripts, undefined);
  assert.equal(actual.devDependencies, undefined);
  assert.equal(actual.private, undefined);
  assert.deepEqual(actual.dependencies, { undici: '^7' });
  assert.deepEqual(actual.peerDependencies, { react: '>=18', '@deepseek-ai/cordis': '~4.0.5' });
  for (const spec of ['workspace:*', 'link:../local', 'file:./lib', 'C:\\personal', 'git+https://example.test/repo.git']) {
    assert.throws(() => releaseMetadata({ license: 'MIT', dependencies: { plugin: spec } }), /Nonportable/u);
  }
});

test('packaging refuses personal configuration, old machine paths and browser bindings', () => {
  for (const name of ['auth.json', 'data/.env', 'tokens.json', 'User Data/Default/Cookies', 'config/credentials.json']) {
    assert.throws(() => assertPublicFile(name, Buffer.from('{}')), /cannot be packaged/u);
  }
  for (const text of ['const path = "D:\\_code\\private\\project";']) {
    assert.throws(() => assertPublicFile('lib/index.js', Buffer.from(text)), /Personal checkout path/u);
  }
  const syntheticBrowser = ['synthetic', 'browser'].join('-');
  assert.throws(() => assertPublicFile('dsh-bsk-bridge/cordis.patch.yml', Buffer.from(`browser: '${syntheticBrowser}'`)), /remain unbound/u);
  assertPublicFile('dsh-bsk-bridge/cordis.patch.yml', Buffer.from("browser: ''\n"));
  assertPublicFile('lib/path-parser.js', Buffer.from('// Handles a Windows path such as D:\\demo\\project.'));
  assertPublicFile('lib/oauth-token-parser.js', Buffer.from('export const field = "access_token";'));
});

test('release refuses synthetic credentials and private deny values without printing them', async t => {
  const synthetic = `sk-${'Z'.repeat(36)}`;
  assert.throws(() => assertPublicFile('lib/client.js', Buffer.from(`const key='${synthetic}'`)), error =>
    /credential/u.test(error.message) && !error.message.includes(synthetic));
  for (const credential of [`${['p', 't'].join('')}-${'Q'.repeat(40)}`, `${1}${'/'.repeat(2)}${'R'.repeat(40)}`]) {
    assert.throws(() => assertPublicFile('lib/oauth.js', Buffer.from(`const value='${credential}'`)), error =>
      /credential/u.test(error.message) && !error.message.includes(credential));
  }
  const privateValue = `private-test-${'x'.repeat(25)}`;
  const root = await fixture(t);
  const file = join(root, 'private-deny.json');
  await json(file, [privateValue]);
  const denied = privateDenyValues({ DSH_PROFILE_DENY_SECRETS_FILE: file });
  assert.throws(() => assertNoSecrets('asset.bin', Buffer.from(`prefix${privateValue}suffix`), denied), error =>
    /protected secret/u.test(error.message) && !error.message.includes(privateValue));
  assert.throws(() => assertNoSecrets('private.pem', Buffer.from('-----BEGIN PRIVATE KEY-----')), /credential/u);
  await writeFile(file, privateValue);
  assert.throws(() => privateDenyValues({ DSH_PROFILE_DENY_SECRETS_FILE: file }), error =>
    /contents are omitted/u.test(error.message) && !error.message.includes(privateValue));
});

test('runtime exports and patches must be present in the npm inventory', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'lib'));
  await writeFile(join(root, 'LICENSE'), 'Fixture license\n');
  await writeFile(join(root, 'cordis.patch.yml'), '[]\n');
  const metadata = { name: 'fixture-plugin', version: '1.0.0', license: 'MIT', main: './lib/missing.js',
    files: ['lib', 'cordis.patch.yml', 'LICENSE'], dsh: { bundle: { patch: './cordis.patch.yml' } } };
  await json(join(root, 'package.json'), metadata);
  await assert.rejects(validatePackageFiles(root, metadata), /Runtime file missing/u);
});

test('real npm packages and ZIP include runnable installer and all nine local archives', { timeout: 180_000 }, async t => {
  const f = await buildFixture(t);
  const recipe = JSON.parse(await readFile(f.manifestPath, 'utf8'));
  recipe.baseline = { host: 'next', runtimeVersion: '1.0.0-rc.1', applicationVersion: '1.0.0-rc.1.20261107.1' };
  await json(f.manifestPath, recipe);
  const output = join(f.root, 'output');
  const result = await buildRelease({ repository: f.repo, sources: f.repo, manifestPath: f.manifestPath, output, zip: process.platform === 'win32' });
  assert.equal((await loadRelease(join(result.stage, 'profile', 'manifest.json'))).plugins.length, 9);
  assert.equal((await readFile(result.tgz)).subarray(0, 2).toString('hex'), '1f8b');
  const extracted = join(f.root, 'extract');
  await mkdir(extracted);
  await execute('tar', ['-xzf', result.tgz, '-C', extracted]);
  const metadata = JSON.parse(await readFile(join(extracted, 'package', 'package.json'), 'utf8'));
  assert.equal(metadata.scripts, undefined);
  assert.ok((await execute(process.execPath, [join(extracted, 'package', 'src', 'cli.mjs'), '--help'])).stdout.includes('--dry-run'));
  const packed = await loadRelease(join(extracted, 'package', 'profile', 'manifest.json'));
  assert.deepEqual(packed.manifest.baseline, recipe.baseline);
  const pluginDir = join(f.root, 'plugin');
  await mkdir(pluginDir);
  await execute('tar', ['-xzf', packed.plugins[0].archivePath, '-C', pluginDir]);
  const plugin = JSON.parse(await readFile(join(pluginDir, 'package', 'package.json'), 'utf8'));
  assert.equal(plugin.scripts, undefined);
  assert.equal(plugin.devDependencies, undefined);
  assert.equal(plugin.dependencies['example-runtime'], '^1.0.0');
  assert.ok((await readFile(join(pluginDir, 'package', 'LICENSE'), 'utf8')).includes('Fixture license'));
  const downloadWork = join(f.root, 'download');
  await mkdir(downloadWork);
  const firstPlugin = packed.plugins[0];
  const downloaded = await unpackLockedArchive({ ...firstPlugin, url: `https://example.test/${firstPlugin.name}.tgz` },
    downloadWork, async () => new Response(await readFile(firstPlugin.archivePath)));
  assert.ok(downloaded.archivePath.endsWith('.tgz'));
  const dlx = await pnpm(['dlx', '--package', result.tgz, 'dsh-next-profile', '--help'], f.root);
  assert.match(dlx.stdout, /dsh-next-profile \[--host/u);
  if (result.zip) {
    const zip = await readFile(result.zip);
    assert.equal(zip.subarray(0, 2).toString(), 'PK');
    for (const name of ['Install.cmd', 'profile/manifest.json', 'src/cli.mjs', ...packed.plugins.map(plugin => plugin.archive)]) {
      assert.ok(zip.includes(Buffer.from(name)), `ZIP entry ${name}`);
    }
  }
  await json(f.manifestPath, { schemaVersion: 1, plugins: packed.plugins.map(({ name, version, sha256 }) =>
    ({ name, version, url: `https://example.test/${name}.tgz`, sha256 })) });
  const thin = await smokePackage(f.repo);
  assert.ok(!thin.files.some(file => file.path.startsWith('vendor/') || file.path.startsWith('artifacts/')));
  await assert.rejects(buildRelease({ repository: f.repo, sources: f.repo, manifestPath: f.manifestPath, output, zip: false }), { code: 'EEXIST' });
});

test('a custom scoped source recipe builds a single archive without a fixed default list', { timeout: 60_000 }, async t => {
  const f = await buildFixture(t, ['@custom/single-plugin']);
  const result = await buildRelease({ repository: f.repo, sources: f.repo, manifestPath: f.manifestPath,
    output: join(f.root, 'output'), zip: false });
  const release = await loadRelease(join(result.stage, 'profile', 'manifest.json'));
  assert.equal(release.plugins.length, 1);
  assert.equal(release.plugins[0].name, '@custom/single-plugin');
  assert.equal(release.plugins[0].archive, 'artifacts/@custom+single-plugin-1.0.0.tgz');
  const plugin = release.plugins[0];
  await json(f.manifestPath, { schemaVersion: 1, plugins: [{ name: plugin.name, version: plugin.version,
    url: 'https://example.test/single.tgz', sha256: plugin.sha256 }] });
  const compatibility = join(f.root, 'record.json');
  await json(compatibility, { schemaVersion: 1, plugins: [{ name: plugin.name, version: plugin.version,
    status: 'static-interfaces-matched-runtime-unverified', runtimeVerification: 'not-run' }] });
  const reused = await buildRelease({ repository: f.repo, manifestPath: f.manifestPath,
    archives: dirname(plugin.archivePath), compatibility, output: join(f.root, 'reused'), zip: false });
  const second = await loadRelease(join(reused.stage, 'profile', 'manifest.json'));
  assert.deepEqual(await readFile(second.plugins[0].archivePath), await readFile(plugin.archivePath));
  assert.equal(second.compatibility.plugins[0].runtimeVerification, 'not-run');
});
