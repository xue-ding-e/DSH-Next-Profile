import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, link, mkdir, readFile, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { execute, cleanEnvironment } from '../src/process.mjs';
import { inspectRuntime, installationEnvironment } from '../src/runtime.mjs';
import { fixture, repository } from './fixtures.mjs';
import { pnpm } from '../scripts/pack-tools.mjs';

test('packaged CLI installs a pristine home, verifies nine bundles and repeats without changes', {
  skip: process.platform !== 'win32' || !process.env.DSH_NEXT_TEST_APP_DIR || !process.env.DSH_PROFILE_TEST_RELEASE_DIR,
  timeout: 240_000,
}, async t => {
  const root = await fixture(t);
  const app = join(root, 'private app');
  await mkdir(app);
  const source = process.env.DSH_NEXT_TEST_APP_DIR;
  // A private executable path lets the real process guard distinguish this test from the user's running Desktop.
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (['resources', 'locales'].includes(entry.name)) await symlink(join(source, entry.name), join(app, entry.name), 'junction');
    } else if (entry.name === 'DSH Next.exe' || /\.(?:dll|bin|pak|dat)$/u.test(entry.name)) {
      try { await link(join(source, entry.name), join(app, entry.name)); }
      catch (error) { if (error.code !== 'EXDEV') throw error; await copyFile(join(source, entry.name), join(app, entry.name)); }
    }
  }
  const runtime = await inspectRuntime(app, 'next');
  const home = join(root, 'blank home');
  const user = join(root, 'os user');
  const release = process.env.DSH_PROFILE_TEST_RELEASE_DIR;
  const env = Object.fromEntries(Object.entries(cleanEnvironment()).filter(([key]) =>
    !/^(?:DSH_|DEEPSEEK_|ANTHROPIC_|OPENAI_|CLAUDE_|CODEX_|QODER_|GITHUB_TOKEN|GH_TOKEN)/iu.test(key)));
  Object.assign(env, { USERPROFILE: user, APPDATA: join(user, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(user, 'AppData', 'Local') });
  for (const directory of [user, env.APPDATA, env.LOCALAPPDATA]) await mkdir(directory, { recursive: true });
  const command = action => execute(runtime.node, [join(release, 'src', 'cli.mjs'), action,
    '--host', 'next', '--app-dir', app, '--home', home, '--isolated', '--json'],
  { env, cwd: root, timeout: 150_000, label: `installed Profile ${action}` });
  const installed = JSON.parse((await command('install')).stdout);
  assert.equal(installed.codeInstalled, true);
  assert.equal(installed.changed, true);
  assert.equal(installed.rows.length, 9);
  const metadata = join(home, 'profiles', 'desktop', 'package.json');
  const before = await readFile(metadata);
  const repeated = JSON.parse((await command('install')).stdout);
  assert.equal(repeated.changed, false);
  assert.deepEqual(await readFile(metadata), before);
  const checked = JSON.parse((await command('check')).stdout);
  assert.equal(checked.codeInstalled, true);
  const diagnosed = JSON.parse((await command('doctor')).stdout);
  assert.equal(diagnosed.codeInstalled, true);
  assert.equal(diagnosed.rows.every(row => row.enabled && row.installed), true);
  assert.equal(diagnosed.guiVerified, false);
  if (process.env.DSH_PROFILE_TEST_PUBLIC_PACKAGE) {
    const published = await pnpm(['--config.dlx-cache-max-age=0', '--config.cache-dir=' + join(root, 'pnpm-cache'),
      '--config.store-dir=' + join(root, 'pnpm-store'), 'dlx', '--package', process.env.DSH_PROFILE_TEST_PUBLIC_PACKAGE,
      'dsh-next-profile', '--host', 'next', '--app-dir', app, '--home', home, '--isolated', '--check'], root,
    { env, label: 'published Profile cold-cache check' });
    assert.match(published.stdout, /installed=true, bundle=true/u);
    assert.deepEqual(await readFile(metadata), before);
    t.diagnostic('Published npm exec package verified the same private installed plugin set.');
  }
  await bootHost(t, runtime, home, env, root);
  t.diagnostic(`Real packaged runtime ${runtime.version}: initialized, installed, checked, diagnosed and repeated 9/9.`);
});

/** Start the real Desktop Host through its shipped profile, then require its shutdown acknowledgement. */
async function bootHost(t, runtime, home, environment, cwd) {
  const resources = join(runtime.root, 'resources');
  const tree = join(resources, 'app.asar', 'dsh');
  const primary = join(resources, 'runtime', 'primary-runtime');
  const child = spawn(runtime.executable, ['--expose-internals',
    join(tree, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js'),
    tree, join(home, 'profiles', 'desktop'), primary,
    join(primary, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'), join(resources, 'runtime', 'bin')], {
    env: installationEnvironment(home, environment, 'next'), cwd, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let diagnostics = '';
  child.stdout.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-32_000); });
  child.stderr.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-32_000); });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  let shutdownComplete = false;
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Desktop Host exited before readiness (${code}): ${diagnostics}`)));
    child.on('message', message => {
      if (message?.type === 'ready') resolve(message);
      else if (message?.type === 'fatal') reject(new Error(`Desktop Host failed: ${message.message}`));
      else if (message?.type === 'shutdown-complete') shutdownComplete = true;
    });
  });
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; child.kill(); }, 45_000);
  const cleanup = async () => {
    clearTimeout(deadline);
    if (child.connected) child.send({ type: 'shutdown' }, () => {});
    const cleanupDeadline = setTimeout(() => { child.kill(); }, 10_000);
    try { await closed; } finally { clearTimeout(cleanupDeadline); }
  };
  try {
    const message = await ready;
    assert.equal(typeof message.url, 'string');
    const response = await fetch(message.url, { signal: AbortSignal.timeout(10_000) });
    assert.ok([200, 401].includes(response.status));
    if (response.status === 200) assert.match(await response.text(), /(?:ModuleLoader|html)/iu);
    else await response.body?.cancel();
    child.send({ type: 'shutdown' });
    const result = await closed;
    clearTimeout(deadline);
    assert.equal(timedOut, false, diagnostics);
    assert.equal(result.signal, null, diagnostics);
    assert.equal(result.code, 0, diagnostics);
    assert.equal(shutdownComplete, true);
    t.diagnostic('Real Desktop Host reached ready, answered HTTP and acknowledged graceful shutdown.');
  } finally { await cleanup(); }
}
