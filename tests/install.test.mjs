import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { install } from '../src/install.mjs';
import { sha256 } from '../src/manifest.mjs';
import { installationEnvironment } from '../src/runtime.mjs';
import { fakeRuntime, installerFixture, json } from './fixtures.mjs';

const options = f => ({ manifest: f.manifest, home: f.home });
const missing = path => assert.rejects(access(path), { code: 'ENOENT' });

test('dry run validates before writing and check reports incomplete installation', async t => {
  const f = await installerFixture(t);
  const hooks = fakeRuntime(f);
  const before = await readFile(join(f.profile, 'package.json'));
  await install({ ...options(f), dryRun: true }, hooks);
  await assert.rejects(install({ ...options(f), check: true }, hooks), /incomplete/u);
  assert.deepEqual(await readFile(join(f.profile, 'package.json')), before);
  await missing(join(f.profile, '.extension-pack'));
  assert.equal(hooks.calls.length, 0);
});

test('installation uses supported desktop CLI, stable tgz paths and the Next home', async t => {
  const f = await installerFixture(t);
  const hooks = fakeRuntime(f);
  const auth = await readFile(join(f.home, 'auth.json'));
  const result = await install(options(f), hooks);
  assert.equal(result.changed, true);
  const [add, enable] = hooks.calls;
  assert.equal(add.command, f.runtime.executable);
  assert.deepEqual(add.args.slice(0, 6), ['--expose-internals', f.runtime.cli, 'plugin', '--profile', 'desktop', 'add']);
  assert.equal(add.args.length, 15);
  assert.equal(add.options.env.DSH_HOME, f.home);
  assert.equal(add.options.env.DSH_NEXT_HOME, f.home);
  assert.equal(add.options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(add.options.timeout, 0);
  for (let index = 0; index < 9; index++) {
    const path = add.args[index + 6];
    assert.ok(path.startsWith(join(f.profile, '.extension-pack', 'artifacts')));
    assert.equal(await sha256(path), f.plugins[index].sha256);
    assert.ok(!path.startsWith(f.release));
  }
  assert.ok(enable.args[1].endsWith('activate.cjs'));
  const metadata = JSON.parse(await readFile(join(f.profile, 'package.json'), 'utf8'));
  assert.equal(metadata.untouched, 'keep me');
  assert.equal(metadata.dependencies.retained, '1.0.0');
  assert.ok(metadata.dsh.profile.bundles.includes('retained-bundle'));
  assert.deepEqual(await readFile(join(f.home, 'auth.json')), auth);
  await missing(join(f.profile, 'lock'));
  await install({ ...options(f), check: true }, hooks);
  await install(options(f), hooks);
  assert.equal(hooks.calls.length, 2, 'matching receipt makes the repeated install a no-op');
});

test('existing disabled collection bundles are enabled and verified', async t => {
  const f = await installerFixture(t);
  const first = fakeRuntime(f);
  await install(options(f), first);
  const path = join(f.profile, 'package.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.dsh.profile.bundles = ['retained-bundle'];
  await json(path, manifest);
  const repair = fakeRuntime(f);
  assert.equal((await install(options(f), repair)).changed, true);
  assert.equal(repair.calls.length, 2);
});

test('locked profiles are refused without deleting or altering their locks', async t => {
  const f = await installerFixture(t);
  const lock = join(f.profile, 'lock');
  await writeFile(lock, 'untrusted lock owner\n');
  await assert.rejects(install(options(f), fakeRuntime(f)), /Profile lock exists/u);
  assert.equal(await readFile(lock, 'utf8'), 'untrusted lock owner\n');
  await missing(join(f.profile, '.extension-pack'));
});

test('the running desktop application prevents every write', async t => {
  const f = await installerFixture(t);
  const hooks = fakeRuntime(f);
  hooks.assertStopped = async () => { throw new Error('Fully quit DSH Next'); };
  await assert.rejects(install(options(f), hooks), /Fully quit/u);
  await missing(join(f.profile, '.extension-pack'));
});

test('uninitialized desktop profiles are never manufactured', async t => {
  const f = await installerFixture(t);
  await assert.rejects(install({ ...options(f), home: join(f.root, 'not-started') }, fakeRuntime(f)), /Open the selected desktop host once/u);
  await missing(join(f.root, 'not-started'));
});

test('CLI failure propagates and preserves account data without a success receipt', async t => {
  const f = await installerFixture(t);
  const auth = await readFile(join(f.home, 'auth.json'));
  await assert.rejects(install(options(f), fakeRuntime(f, { fail: true })), /exit 17[\s\S]*diagnostics/u);
  await missing(join(f.profile, '.extension-pack', 'installed.json'));
  await missing(join(f.profile, 'lock'));
  assert.deepEqual(await readFile(join(f.home, 'auth.json')), auth);
});

test('successful CLI exit alone cannot hide missing plugin files or bundles', async t => {
  for (const defect of [{ omit: true }, { disabled: true }]) {
    const f = await installerFixture(t);
    await assert.rejects(install(options(f), fakeRuntime(f, defect)), /Post-install verification failed/u);
    await missing(join(f.profile, '.extension-pack', 'installed.json'));
  }
});

test('original host installation maps only its own data directory and strips Next markers', async t => {
  const f = await installerFixture(t);
  f.runtime.host = 'original';
  f.runtime.executable = join(f.runtime.root, 'DeepSeek Harness.exe');
  f.runtime.cli = join(f.runtime.root, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');
  const hooks = fakeRuntime(f);
  await install({ ...options(f), host: 'original' }, hooks);
  assert.equal(hooks.calls[0].options.env.DSH_HOME, f.home);
  assert.equal(hooks.calls[0].options.env.DSH_NEXT_HOME, undefined);
  const original = installationEnvironment(f.home, { DSH_NEXT_HOME: 'next', DSH_NEXT_ACTIVE_HOME: 'next', DSH_HOME: 'next', PATH: 'kept' }, 'original');
  assert.equal(original.DSH_HOME, f.home);
  assert.equal(original.DSH_NEXT_ACTIVE_HOME, undefined);
  assert.equal(original.PATH, 'kept');
  await assert.rejects(install({ ...options(f), host: 'next' }, hooks), /does not match/u);
});

test('a custom single scoped plugin recipe installs and verifies its own count', async t => {
  const f = await installerFixture(t, ['@custom/single-plugin']);
  const hooks = fakeRuntime(f);
  const messages = [];
  hooks.log = message => messages.push(message);
  const result = await install(options(f), hooks);
  assert.equal(result.rows.length, 1);
  assert.equal(hooks.calls[0].args.length, 7);
  assert.ok(messages.some(message => message.includes('1 installed dependencies and 1 selected')));
  assert.ok(!messages.some(message => message.startsWith('Capability')));
  const checked = await install({ ...options(f), check: true }, hooks);
  assert.equal(checked.rows[0].name, '@custom/single-plugin');
});

test('a matching receipt cannot hide corrupted cached archives', async t => {
  const f = await installerFixture(t);
  const hooks = fakeRuntime(f);
  await install(options(f), hooks);
  await writeFile(hooks.calls[0].args[6], 'corrupted cached archive');
  await assert.rejects(install(options(f), hooks), /Cached archive SHA-256 mismatch/u);
  assert.equal(hooks.calls.length, 2);
});
