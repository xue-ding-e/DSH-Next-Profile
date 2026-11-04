import { glob, lstat, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, within } from './manifest.mjs';

export async function optionalJson(path) {
  try { return await readJson(path); }
  catch (error) { if (error.cause?.code === 'ENOENT') return undefined; throw error; }
}

export async function initializedProfile(home) {
  const expected = join(home, 'profiles', 'desktop');
  let profile;
  try { profile = await realpath(expected); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`Open the selected desktop host once using this home, then fully quit it. Desktop profile is not initialized: ${expected}`);
  }
  if (!within(home, profile)) throw new Error('Desktop profile resolves outside the selected Next home.');
  const metadata = await optionalJson(join(profile, 'package.json'));
  if (!metadata || !Array.isArray(metadata.dsh?.profile?.bundles) || !(await stat(join(profile, 'pnpm-workspace.yaml'))).isFile()) {
    throw new Error(`Desktop profile is not initialized. Open the selected desktop host once using ${home}, then fully quit it.`);
  }
  if ((await lstat(join(profile, 'package.json'))).isSymbolicLink()) {
    throw new Error('Refusing a linked desktop profile package.json.');
  }
  return profile;
}

export async function assertNoLocks(profile) {
  for (const name of ['lock', 'package.json.lock']) {
    try { await lstat(join(profile, name)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`Profile lock exists: ${join(profile, name)}. Fully quit the selected desktop host and finish other plugin operations. Open and quit that host to recover a stale lock; the installer never deletes it.`);
  }
  const run = await optionalJson(join(profile, '.plugin-manager', 'run.json'));
  if (run !== undefined) throw new Error('An earlier DSH package operation has a run record. Finish/recover it with the supported dsh plugin CLI before installing.');
}

/** Check package installation and profile selection without loading plugin code or credentials. */
function exportedFiles(value) {
  if (typeof value === 'string') return [value];
  return value && typeof value === 'object' ? Object.values(value).flatMap(exportedFiles) : [];
}

export async function inspectPlugins(profile, plugins) {
  const manifest = await readJson(join(profile, 'package.json'));
  const bundles = manifest.dsh?.profile?.bundles ?? [];
  const rows = [];
  for (const plugin of plugins) {
    const packageRoot = join(profile, 'node_modules', plugin.name);
    const installed = await optionalJson(join(packageRoot, 'package.json'));
    let runtimeFiles = Boolean(installed?.dsh?.bundle?.patch) && Boolean(installed?.main || installed?.exports);
    if (installed && !within(profile, await realpath(packageRoot))) runtimeFiles = false;
    const patch = installed?.dsh?.bundle?.patch;
    for (const file of [installed?.main, ...exportedFiles(installed?.exports), ...(Array.isArray(patch) ? patch : [patch])].filter(Boolean)) {
      const portable = String(file).replace(/^\.\//u, '');
      if (portable.startsWith('/') || portable.split(/[\\/]/u).includes('..') || portable.includes(':')) {
        runtimeFiles = false;
        continue;
      }
      let found = false;
      for await (const path of glob(portable, { cwd: packageRoot })) {
        const full = join(packageRoot, path);
        if ((await stat(full)).isFile() && within(await realpath(packageRoot), await realpath(full))) found = true;
        else runtimeFiles = false;
      }
      runtimeFiles &&= found;
    }
    rows.push({ name: plugin.name, dependency: typeof manifest.dependencies?.[plugin.name] === 'string',
      installed: installed?.name === plugin.name && installed?.version === plugin.version && runtimeFiles,
      enabled: bundles.includes(plugin.name) });
  }
  return rows;
}

export const complete = rows => rows.every(row => row.dependency && row.installed && row.enabled);

export async function assertOwnedDirectory(root, path) {
  const actual = await realpath(path);
  if (!within(root, actual) || (await lstat(path)).isSymbolicLink()) {
    throw new Error(`Refusing linked installer state outside its owned directory: ${path}`);
  }
}
