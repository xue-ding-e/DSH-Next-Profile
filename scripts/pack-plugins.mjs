import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { archiveFilename, readJson, sha256, validateManifest, within } from '../src/manifest.mjs';
import { packPlugin, root } from './pack-tools.mjs';

/** Pack once, then reuse these immutable bytes for plugin assets and installer bundles. */
export async function packPlugins({ sources, manifestPath = join(root, 'profile', 'manifest.json'),
  output = join(root, '.output', 'plugins'), tag = 'v0.1.0', writeLock = false } = {}) {
  if (!sources) throw new Error('--sources is required to pack plugin sources.');
  const sourceRoot = await realpath(resolve(sources));
  const recipe = validateManifest(await readJson(manifestPath), 'source');
  output = resolve(output);
  if (within(sourceRoot, output)) throw new Error('Output cannot be inside the plugin source root.');
  const artifacts = join(output, 'artifacts');
  await mkdir(output, { recursive: true });
  await mkdir(artifacts);
  const work = await mkdtemp(join(output, '.pack-'));
  try {
    const plugins = [];
    for (const plugin of recipe.plugins) {
      if (!plugin.source) throw new Error(`Missing source directory: ${plugin.name}`);
      const archive = await packPlugin(sourceRoot, plugin, work, artifacts);
      const digest = await sha256(join(output, archive.archive));
      if (plugin.sha256 && plugin.sha256 !== digest) throw new Error(`Source archive differs from existing lock: ${plugin.name}`);
      plugins.push({ name: plugin.name, version: plugin.version, source: plugin.source,
        url: `https://github.com/xue-ding-e/DSH-Next-Plugins/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(archiveFilename(plugin))}`,
        sha256: digest });
    }
    // The plugin repository's lock contains plugin assets only. Profile-owned host evidence is
    // copied and hash-checked by build-release when the installer package is assembled.
    const lock = validateManifest({ schemaVersion: 1, plugins });
    await writeFile(join(output, 'manifest.json'), `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx' });
    await writeFile(join(output, 'SHA256SUMS'), plugins.map(plugin => `${plugin.sha256}  artifacts/${archiveFilename(plugin)}\n`).join(''), { flag: 'wx' });
    if (writeLock) {
      const temp = `${manifestPath}.tmp`;
      await writeFile(temp, `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx' });
      await rename(temp, manifestPath);
    }
    console.log(`Packed ${plugins.length} immutable plugin archives: ${artifacts}`);
    return { artifacts, plugins, manifest: join(output, 'manifest.json') };
  } finally {
    if (!within(await realpath(output), await realpath(work))) throw new Error('Refusing cleanup outside plugin build output.');
    await rm(work, { recursive: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { sources: { type: 'string' }, manifest: { type: 'string' },
    output: { type: 'string' }, tag: { type: 'string' }, 'write-lock': { type: 'boolean' } } });
  packPlugins({ sources: values.sources, manifestPath: values.manifest ? resolve(values.manifest) : undefined,
    output: values.output, tag: values.tag, writeLock: values['write-lock'] }).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
