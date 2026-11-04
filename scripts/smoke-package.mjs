import { glob, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { confinedPath, portablePath, readJson, sha256, validateManifest } from '../src/manifest.mjs';
import { assertPublicFile, inventory, root } from './pack-tools.mjs';
import { validateCompatibility } from '../src/compatibility.mjs';

function exportTargets(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(exportTargets);
  return [];
}

/** Assert that npm consumers receive runnable exports and every DSH patch. */
export async function validatePackageFiles(directory, metadata) {
  const pack = await inventory(directory);
  const packed = new Set(pack.files.map(file => file.path));
  const patch = metadata.dsh?.bundle?.patch;
  if (!patch || (!metadata.main && !metadata.exports)) throw new Error(`Missing runtime entry or bundle patch: ${metadata.name}`);
  if (![...packed].some(name => /(?:^|\/)(?:licen[cs]e|copying)(?:\.[^/]*)?$/iu.test(name))) {
    throw new Error(`Missing LICENSE/COPYING file in ${metadata.name}; preserve its upstream license in vendor/.`);
  }
  const targets = [metadata.main, ...exportTargets(metadata.exports),
    ...Object.values(typeof metadata.bin === 'object' ? metadata.bin : metadata.bin ? { bin: metadata.bin } : {}),
    ...(Array.isArray(patch) ? patch : [patch])].filter(Boolean);
  for (const target of targets) {
    const pattern = target.replace(/^\.\//u, '');
    if (pattern.includes('..') || pattern.includes('\\') || pattern.includes(':') || pattern.startsWith('/')) {
      throw new Error(`Nonportable entry point in ${metadata.name}: ${target}`);
    }
    const matches = [];
    for await (const file of glob(pattern, { cwd: directory })) if (packed.has(file.replaceAll('\\', '/'))) matches.push(file);
    if (!matches.length) throw new Error(`Runtime file missing from npm pack: ${metadata.name} -> ${target}`);
  }
  if (!pack.files.some(file => /\.(?:[cm]?js)$/u.test(file.path))) {
    throw new Error(`No built JavaScript in ${metadata.name}. Build it before packaging.`);
  }
  for (const file of pack.files) {
    portablePath(file.path);
    assertPublicFile(`${metadata.name}/${file.path}`, await readFile(join(directory, file.path)));
  }
}

export async function smokePackage(directory) {
  const manifestPath = join(directory, 'profile', 'manifest.json');
  const lock = validateManifest(await readJson(manifestPath));
  for (const plugin of lock.plugins) {
    if (plugin.archive && await sha256(await confinedPath(directory, plugin.archive)) !== plugin.sha256) {
      throw new Error(`Archive SHA-256 mismatch: ${plugin.name}`);
    }
  }
  if (lock.compatibility) {
    const path = await confinedPath(directory, lock.compatibility.path);
    if (await sha256(path) !== lock.compatibility.sha256) throw new Error('Compatibility record SHA-256 mismatch.');
    validateCompatibility(await readJson(path), lock.plugins);
  }
  const metadata = await readJson(join(directory, 'package.json'));
  if (metadata.bin?.['dsh-next-profile'] !== 'src/cli.mjs') throw new Error('npm package has no dsh-next-profile CLI.');
  const pack = await inventory(directory);
  const files = new Set(pack.files.map(file => file.path));
  for (const name of ['src/cli.mjs', 'src/install.mjs', 'src/runtime-probe.cjs', 'src/activate.cjs',
    'installer/Install.ps1', 'installer/Find-DshNext.ps1', 'profile/manifest.json',
    ...(lock.compatibility ? [lock.compatibility.path] : []),
    ...lock.plugins.flatMap(plugin => plugin.archive ? [plugin.archive] : [])]) {
    if (!files.has(name) || !(await stat(join(directory, name))).isFile()) throw new Error(`Installer npm package is incomplete: ${name}`);
  }
  for (const file of pack.files) assertPublicFile(file.path, await readFile(join(directory, file.path)));
  const local = lock.plugins.filter(plugin => plugin.archive).length;
  console.log(`Package smoke passed: CLI, runtime helpers, manifest, ${local} local archives, ${lock.plugins.length - local} public URL locks.`);
  return pack;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { directory: { type: 'string' } } });
  smokePackage(resolve(values.directory || join(root, 'scripts', '.output', 'package'))).catch(error => {
    console.error(error.stack || error.message); process.exitCode = 1;
  });
}
