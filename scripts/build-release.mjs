import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { archiveFilename, confinedPath, readJson, sha256, validateManifest, within } from '../src/manifest.mjs';
import { cleanEnvironment, execute } from '../src/process.mjs';
import { powershell } from '../src/runtime.mjs';
import { assertPublicFile, copyPublicFile, inspectPluginArchive, npm, packPlugin, root, unpackLockedArchive } from './pack-tools.mjs';
import { validateCompatibility } from '../src/compatibility.mjs';
import { smokePackage } from './smoke-package.mjs';

async function copyTree(repository, stage, directory) {
  for (const entry of await readdir(join(repository, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await copyTree(repository, stage, name);
    else await copyPublicFile(repository, stage, name);
  }
}

/** Assemble an installer from external sources or immutable, hash-locked archives. */
export async function buildRelease({ repository = root, manifestPath = join(repository, 'profile', 'manifest.json'),
  sources, archives, compatibility, output = join(repository, '.output', 'full'), zip = true, request } = {}) {
  repository = await realpath(repository);
  if (sources) sources = await realpath(resolve(sources));
  if (archives) archives = await realpath(resolve(archives));
  if (sources && archives) throw new Error('Select either --sources or --archives.');
  const manifest = validateManifest(await readJson(manifestPath), sources ? 'source' : 'release');
  const packageMetadata = await readJson(join(repository, 'package.json'));
  output = resolve(output);
  if (within(join(repository, 'vendor'), output) || within(join(repository, 'src'), output)
    || (sources && within(sources, output))
    || (archives && within(archives, output))
    || output === repository) throw new Error('Choose a separate build output directory.');
  await mkdir(output, { recursive: true });
  const stage = join(output, 'package');
  await mkdir(stage);
  const artifacts = join(stage, 'artifacts');
  await mkdir(artifacts);
  const work = await mkdtemp(join(output, '.pack-'));
  try {
    const plugins = [];
    for (const plugin of manifest.plugins) {
      let packed;
      if (archives) {
        if (!plugin.sha256) throw new Error(`An immutable archive needs a SHA-256 lock: ${plugin.name}`);
        const file = await confinedPath(archives, archiveFilename(plugin));
        if (await sha256(file) !== plugin.sha256) throw new Error(`Immutable archive SHA-256 mismatch: ${plugin.name}`);
        const verified = await inspectPluginArchive(file, plugin, work);
        await copyFile(file, join(artifacts, verified.filename));
        packed = { name: plugin.name, version: plugin.version, archive: `artifacts/${verified.filename}` };
      } else if (sources && plugin.source) packed = await packPlugin(sources, plugin, work, artifacts);
      else {
        if (!plugin.url) throw new Error(`Use --sources with an external source root, or provide a locked URL: ${plugin.name}`);
        const downloaded = await unpackLockedArchive(plugin, work, request);
        await copyFile(downloaded.archivePath, join(artifacts, downloaded.filename));
        packed = { name: plugin.name, version: plugin.version, archive: `artifacts/${downloaded.filename}` };
      }
      const digest = await sha256(await confinedPath(stage, packed.archive));
      if (plugin.sha256 && digest !== plugin.sha256) throw new Error(`Built archive differs from the locked SHA-256: ${plugin.name}`);
      plugins.push({ ...packed, sha256: digest });
    }
    validateManifest({ schemaVersion: 1, plugins });
    for (const directory of ['src', 'installer']) await copyTree(repository, stage, directory);
    for (const file of ['README.md', 'README.zh.md', 'LICENSE']) await copyPublicFile(repository, stage, file);
    await mkdir(join(stage, 'profile'));
    const releaseManifest = { schemaVersion: 1, plugins };
    if (compatibility) {
      const bytes = await readFile(compatibility);
      validateCompatibility(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/u, '')), plugins);
      assertPublicFile('profile/compatibility.json', bytes);
      await writeFile(join(stage, 'profile', 'compatibility.json'), bytes);
      releaseManifest.compatibility = { path: 'profile/compatibility.json', sha256: await sha256(join(stage, 'profile', 'compatibility.json')) };
    }
    await writeFile(join(stage, 'profile', 'manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`);
    const { scripts, devDependencies, private: privatePackage, ...metadata } = packageMetadata;
    await writeFile(join(stage, 'package.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    await chmod(join(stage, 'src', 'cli.mjs'), 0o755);
    await copyFile(join(repository, 'installer', 'Install.cmd'), join(stage, 'Install.cmd'));
    await smokePackage(stage);
    const packed = await npm(['pack', '--ignore-scripts', '--json', '--pack-destination', output], stage);
    const [npmPackage] = JSON.parse(packed.stdout);
    const tgz = join(output, npmPackage.filename);
    let zipPath;
    if (zip) {
      zipPath = join(output, `${packageMetadata.name}-${packageMetadata.version}-windows.zip`);
      if (process.platform === 'win32') {
        await execute(powershell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
          join(repository, 'installer', 'New-ReleaseZip.ps1'), '-Source', stage, '-Destination', zipPath], { env: cleanEnvironment(), timeout: 120_000 });
      } else {
        await execute('zip', ['-q', '-r', zipPath, '.'], { cwd: stage, timeout: 120_000 });
      }
    }
    const checksums = [tgz, ...(zipPath ? [zipPath] : [])];
    await writeFile(join(output, 'SHA256SUMS'), (await Promise.all(checksums.map(async path =>
      `${await sha256(path)}  ${path.slice(output.length + 1)}`))).join('\n') + '\n');
    console.log(`Release built:\n${tgz}${zipPath ? `\n${zipPath}` : ''}`);
    return { stage, tgz, zip: zipPath, plugins };
  } finally {
    const actual = await realpath(work);
    if (!within(await realpath(output), actual)) throw new Error('Refusing cleanup outside build output.');
    await rm(actual, { recursive: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { sources: { type: 'string' }, archives: { type: 'string' }, compatibility: { type: 'string' }, manifest: { type: 'string' }, output: { type: 'string' }, 'no-zip': { type: 'boolean' } } });
  buildRelease({ manifestPath: values.manifest ? resolve(values.manifest) : undefined,
    sources: values.sources, archives: values.archives, compatibility: values.compatibility,
    output: values.output ? resolve(values.output) : undefined, zip: !values['no-zip'] }).catch(error => {
    console.error(error.stack || error.message); process.exitCode = 1;
  });
}
