import { copyFile, lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRelease, readJson, sha256 } from './manifest.mjs';
import { execute } from './process.mjs';
import { assertAppStopped, discoverApp, inspectRuntime, installationEnvironment, resolveHome, validateIsolation } from './runtime.mjs';
import { assertNoLocks, assertOwnedDirectory, complete, initializedProfile, inspectPlugins, optionalJson } from './profile.mjs';
import { capabilityNotices, hostIdentity } from './hosts.mjs';
import { reportCompatibility } from './compatibility.mjs';

const source = dirname(fileURLToPath(import.meta.url));
export const configurationNotice = 'Restart the selected desktop client. Plugin code installation is complete; configure authorizations and local resources required by the installed plugins separately.';

function reportSetup(log, plugins) {
  log(configurationNotice);
  const setup = {
    'dsh-browser-control': 'Browser website logins belong to this computer; sign in as needed.',
    'dsh-qoder-connect': 'Configure your own Qoder PAT.',
    'dsh-bsk-bridge': 'Explicitly bind the intended BSK browser before use.',
    'dsh-whale-boot': 'Whale video resources are not included and remain to be supplied.',
    'dsh-plugin-subscriptions': 'Configure provider OAuth applications (including Antigravity when required) and authorize each provider.',
  };
  for (const { name } of plugins) if (Object.hasOwn(setup, name)) log(`Setup (${name}): ${setup[name]}`);
}

async function persistArchives(profile, plugins) {
  const state = join(profile, '.extension-pack');
  await mkdir(state, { recursive: true, mode: 0o700 });
  await assertOwnedDirectory(profile, state);
  const archives = join(state, 'artifacts');
  await mkdir(archives, { recursive: true, mode: 0o700 });
  await assertOwnedDirectory(state, archives);
  const paths = [];
  for (const plugin of plugins) {
    const destination = join(archives, `${plugin.sha256}-${basename(plugin.archive)}`);
    try {
      if (plugin.archiveBytes) await writeFile(destination, plugin.archiveBytes, { flag: 'wx', mode: 0o600 });
      else await copyFile(plugin.archivePath, destination, constants.COPYFILE_EXCL);
    }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await lstat(destination);
    if (!info.isFile() || info.isSymbolicLink() || await sha256(destination) !== plugin.sha256) throw new Error(`Cached archive SHA-256 mismatch or linked file: ${destination}`);
    paths.push(destination);
  }
  return { state, paths };
}

async function saveReceipt(state, plugins) {
  const temp = join(state, `installed-${randomUUID()}.tmp`);
  const record = { schemaVersion: 1, plugins: plugins.map(({ name, version, sha256 }) => ({ name, version, sha256 })) };
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  try { await rename(temp, join(state, 'installed.json')); }
  finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function cachedInstallation(profile, plugins) {
  const metadata = await readJson(join(profile, 'package.json'));
  const state = join(profile, '.extension-pack');
  await assertOwnedDirectory(profile, state);
  await assertOwnedDirectory(state, join(state, 'artifacts'));
  for (const plugin of plugins) {
    const path = join(state, 'artifacts', `${plugin.sha256}-${basename(plugin.archive)}`);
    let info;
    try { info = await lstat(path); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    if (!info.isFile() || info.isSymbolicLink() || await sha256(path) !== plugin.sha256) {
      throw new Error(`Cached archive SHA-256 mismatch or linked file: ${path}`);
    }
    const spec = metadata.dependencies?.[plugin.name];
    if (!spec?.startsWith('file:') || relative(path, resolve(profile, spec.slice(5))) !== '') return false;
  }
  return true;
}

export async function install(options, hooks = {}) {
  const log = hooks.log ?? console.log;
  const release = await loadRelease(options.manifest, hooks.request);
  const runtime = hooks.runtime ?? (options.appDir ? await inspectRuntime(options.appDir, options.host) : await discoverApp(options.host));
  const host = runtime.host ?? 'next';
  const identity = hostIdentity(host);
  if (options.host && options.host !== host) throw new Error('Selected host does not match the installed package identity.');
  const home = await resolveHome(options.home, runtime.root, process.env, undefined, host);
  await validateIsolation(options, home, runtime);
  const profile = await initializedProfile(home);
  await (hooks.assertStopped ?? assertAppStopped)(runtime.root, host, options);
  await assertNoLocks(profile);
  const rows = await inspectPlugins(profile, release.plugins);
  log(`${identity.product} ${runtime.version} (host=${host})\nApplication: ${runtime.root}\nDSH_HOME: ${home}\nProfile: ${profile}\nVerified release archives: ${release.plugins.length}`);
  reportCompatibility(release.compatibility, release.plugins, host, runtime.version, log);
  for (const notice of capabilityNotices) {
    if (release.plugins.some(plugin => plugin.name === notice.plugin)) log(`Capability (${notice.plugin}): ${notice.message}`);
  }
  if (options.check) {
    for (const row of rows) log(`${row.name}: dependency=${row.dependency}, installed=${row.installed}, bundle=${row.enabled}`);
    if (!complete(rows)) throw new Error('The extension collection is incomplete; run the installer without --check to install/repair it.');
    reportSetup(log, release.plugins);
    return { home, profile, rows, changed: false };
  }
  if (options.dryRun) {
    log(`Dry run: no profile files changed. Would cache ${release.plugins.length} verified archives, run dsh plugin --profile desktop add <cached archives>, enable their bundles, and verify the result.`);
    return { home, profile, rows, changed: false };
  }
  // The GUI checks this same lock during profile preparation; CLI owns package.json.lock separately.
  const lockPath = join(profile, 'lock');
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    await lock.writeFile(`${process.pid}\n`);
    await lock.sync();
    await (hooks.assertStopped ?? assertAppStopped)(runtime.root, host, options);
    const statePath = join(profile, '.extension-pack');
    try { await lstat(statePath); await assertOwnedDirectory(profile, statePath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const receiptPath = join(statePath, 'installed.json');
    try { if ((await lstat(receiptPath)).isSymbolicLink()) throw new Error('Refusing a linked installer receipt.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const receipt = await optionalJson(receiptPath);
    const recorded = receipt?.schemaVersion === 1 && Array.isArray(receipt.plugins) && release.plugins.every(plugin => receipt.plugins.some(row => row.name === plugin.name && row.version === plugin.version && row.sha256 === plugin.sha256));
    if (recorded && complete(await inspectPlugins(profile, release.plugins)) && await cachedInstallation(profile, release.plugins)) {
      log(`All ${release.plugins.length} extensions and bundles already match this release.`);
      reportSetup(log, release.plugins);
      return { home, profile, rows, changed: false };
    }
    const { state, paths } = await persistArchives(profile, release.plugins);
    const env = installationEnvironment(home, process.env, host);
    const run = hooks.execute ?? execute;
    await run(runtime.executable, ['--expose-internals', runtime.cli, 'plugin', '--profile', 'desktop', 'add', ...paths],
      { env, cwd: release.root, inherit: true, timeout: 0 });
    if ((await inspectPlugins(profile, release.plugins)).some(row => !row.enabled)) {
      await run(runtime.executable, ['--expose-internals', join(source, 'activate.cjs'), runtime.root, profile, ...release.plugins.map(plugin => plugin.name)],
        { env, cwd: release.root, inherit: true });
    }
    const after = await inspectPlugins(profile, release.plugins);
    if (!complete(after)) throw new Error(`Post-install verification failed: ${JSON.stringify(after)}. See ${join(profile, '.plugin-manager', 'logs')}.`);
    await saveReceipt(state, release.plugins);
    log(`Verified: ${release.plugins.length} installed dependencies and ${release.plugins.length} selected dsh.profile.bundles.`);
    reportSetup(log, release.plugins);
    return { home, profile, rows: after, changed: true };
  } catch (error) {
    throw new Error(`Installation failed: ${error.message}\nDSH diagnostics: ${join(profile, '.plugin-manager', 'logs')}\nFix the reported error, fully quit ${identity.product}, then rerun. No success receipt was written for this attempt.`, { cause: error });
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
