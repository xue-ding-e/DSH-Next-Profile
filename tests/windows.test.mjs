import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execute, cleanEnvironment } from '../src/process.mjs';
import { assertAppStopped, inspectRuntime, installationEnvironment, powershell } from '../src/runtime.mjs';
import { fakeRuntime, installerFixture, repository } from './fixtures.mjs';

test('environment removes Node hooks without mutating the caller', () => {
  const original = { PATH: 'kept', NODE_OPTIONS: '--require attacker', Node_Path: 'attacker', ELECTRON_RUN_AS_NODE: '1' };
  assert.deepEqual(cleanEnvironment(original), { PATH: 'kept' });
  assert.equal(original.NODE_OPTIONS, '--require attacker');
});

test('Windows PowerShell 5.1 parses localized scripts and the ASCII download entry point', { skip: process.platform !== 'win32' }, async () => {
  for (const name of ['Install.ps1', 'Install-Latest.ps1', 'Find-DshNext.ps1', 'New-ReleaseZip.ps1']) {
    const path = join(repository, 'installer', name);
    const bytes = await readFile(path);
    if (name === 'Install-Latest.ps1') assert.equal(bytes.every(byte => byte < 128), true);
    else assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
    const result = await execute(powershell(), ['-NoProfile', '-NonInteractive', '-Command',
      '$tokens=$null; $errors=$null; [void][Management.Automation.Language.Parser]::ParseFile($env:DSH_TEST_PS_FILE,[ref]$tokens,[ref]$errors); if($errors.Count) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }'],
    { env: { ...cleanEnvironment(), DSH_TEST_PS_FILE: path } });
    assert.equal(result.stderr, '');
  }
  const help = await execute(powershell(), ['-NoProfile', '-NonInteractive', '-File', join(repository, 'installer', 'Install.ps1'), '--help']);
  assert.match(help.stdout, /--app-dir/u);
});

test('installed Electron probe, atomic writer and PS shutdown guard use the real runtime', {
  skip: process.platform !== 'win32' || !process.env.DSH_NEXT_TEST_APP_DIR,
}, async t => {
  const f = await installerFixture(t);
  const appDir = process.env.DSH_NEXT_TEST_APP_DIR;
  const runtime = await inspectRuntime(appDir);
  assert.ok(runtime.version);
  const hooks = fakeRuntime(f);
  await hooks.execute('', ['add', ...f.plugins.map(plugin => join(f.release, plugin.archive))], {});
  await execute(runtime.executable, ['--expose-internals', join(repository, 'src', 'activate.cjs'), appDir, f.profile,
    ...f.plugins.map(plugin => plugin.name)], { env: installationEnvironment(f.home) });
  const enabled = JSON.parse(await readFile(join(f.profile, 'package.json'), 'utf8')).dsh.profile.bundles;
  assert.ok(f.plugins.every(plugin => enabled.includes(plugin.name)));
  const before = await readFile(join(f.profile, 'package.json'));
  const command = () => execute(powershell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    join(repository, 'installer', 'Install.ps1'), '--app-dir', appDir, '--home', f.home,
    '--manifest', f.manifest, '--dry-run'], { env: cleanEnvironment() });
  let running = false;
  try { await assertAppStopped(appDir); }
  catch (error) { if (!error.message.includes('Fully quit')) throw error; running = true; }
  if (running) {
    await assert.rejects(command(), /Fully quit/u);
    t.diagnostic('The desktop is running: verified the bootstrap refuses it; no processes were stopped.');
  } else assert.match((await command()).stdout, /Dry run: no profile files changed/u);
  assert.deepEqual(await readFile(join(f.profile, 'package.json')), before);
});

test('Install.cmd invokes PowerShell from a directory with spaces and Chinese characters', { skip: process.platform !== 'win32' }, async t => {
  const f = await installerFixture(t);
  await mkdir(join(f.release, 'installer'));
  await copyFile(join(repository, 'installer', 'Install.cmd'), join(f.release, 'Install.cmd'));
  await copyFile(join(repository, 'installer', 'Install.ps1'), join(f.release, 'installer', 'Install.ps1'));
  const result = await execute(powershell(), ['-NoProfile', '-NonInteractive', '-Command',
    '& $env:DSH_TEST_INSTALL_CMD --help; exit $LASTEXITCODE'], {
    env: { ...cleanEnvironment(), DSH_NEXT_INSTALL_NO_PAUSE: '1', DSH_TEST_INSTALL_CMD: join(f.release, 'Install.cmd') },
  });
  assert.match(result.stdout, /--host original\|next/u);
});
