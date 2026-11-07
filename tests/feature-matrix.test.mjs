import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readRelease, sha256, validateFeatureMatrix } from '../src/manifest.mjs';
import { execute } from '../src/process.mjs';
import { fixture, installerFixture, json, repository } from './fixtures.mjs';

const matrix = name => ({ schemaVersion: 1, fullFeatureHost: 'next', features: [
  { id: 'plugin', name: 'Independent feature', placement: 'plugin', wholeFeaturePluginizable: true,
    status: 'external', package: name, includedByDefault: true },
  { id: 'native', name: 'Native feature', placement: 'source-required', wholeFeaturePluginizable: false,
    status: 'source-currently', reason: 'Requires Electron IPC.' },
] });

test('feature matrix rejects partial-feature claims and missing default packages', () => {
  const value = matrix('test-plugin');
  assert.equal(validateFeatureMatrix(value, [{ name: 'test-plugin' }]), value);
  assert.throws(() => validateFeatureMatrix(value, []), /not in the release/u);
  assert.throws(() => validateFeatureMatrix({ ...value, features: [...value.features, value.features[0]] }), /unique/u);
  assert.throws(() => validateFeatureMatrix({ ...value, features: [{ ...value.features[1], wholeFeaturePluginizable: true }] }), /cannot claim/u);
});

test('features uses hash-locked local metadata without needing any archive or Desktop', async t => {
  const f = await installerFixture(t, ['test-plugin']);
  const path = join(f.release, 'profile', 'feature-matrix.json');
  await json(path, matrix('test-plugin'));
  const manifest = { schemaVersion: 1, plugins: f.plugins.map(({ name, version, sha256 }) => ({
    name, version, sha256, url: `https://example.invalid/${name}.tgz`,
  })), featureMatrix: { path: 'profile/feature-matrix.json', sha256: await sha256(path) } };
  await json(f.manifest, manifest);
  const result = await execute(process.execPath, [join(repository, 'src', 'cli.mjs'), 'features', '--manifest', f.manifest, '--json']);
  assert.deepEqual(JSON.parse(result.stdout), matrix('test-plugin'));
  await json(path, { ...matrix('test-plugin'), fullFeatureHost: 'original' });
  await assert.rejects(readRelease(f.manifest), /Feature matrix SHA-256 mismatch/u);
});

test('CLI rejects conflicting modes with a machine-readable failure', async t => {
  await fixture(t);
  await assert.rejects(execute(process.execPath, [join(repository, 'src', 'cli.mjs'), 'doctor', '--check', '--json']), /cannot be combined/u);
  const source = JSON.parse(await readFile(join(repository, 'profile', 'feature-matrix.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(repository, 'profile', 'manifest.json'), 'utf8'));
  validateFeatureMatrix(source, manifest.plugins);
});
