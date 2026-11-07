import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { archiveUrl, downloadArchive } from './archives.mjs';
import { validateCompatibility } from './compatibility.mjs';

export const PLUGINS = Object.freeze([
  'dsh-browser-control', 'dsh-nav-buttons', 'dsh-input-guard',
  'dsh-whale-boot', 'dsh-bsk-bridge', 'dsh-retry-tuning',
  'dsh-plugin-subscriptions', 'dsh-qoder-connect', 'dsh-chat-import',
]);

export function packageName(value) {
  return typeof value === 'string' && value.length <= 214 && !['node_modules', 'favicon.ico'].includes(value)
    && /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/u.test(value);
}

export function archiveFilename(plugin) {
  return `${plugin.name.replace('/', '+')}-${plugin.version}.tgz`;
}

function exactVersion(value) {
  if (typeof value !== 'string') return false;
  const match = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(value);
  return Boolean(match) && !match[1]?.split('.').some(part => /^0\d+$/u.test(part));
}

export function within(parent, child) {
  const suffix = relative(parent, child);
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
}

/** Portable manifest paths never name a parent, drive, stream, or Windows device. */
export function portablePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || /[<>:"|?*\x00-\x1f]/u.test(value)
    || value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/u.test(part)
      || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part))) {
    throw new Error(`Unsafe manifest path: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Resolve both lexical traversal and links, before reading release or vendor files. */
export async function confinedPath(root, value) {
  portablePath(value);
  const base = await realpath(root);
  const target = resolve(base, value);
  if (!within(base, target) || !within(base, await realpath(target))) {
    throw new Error(`Manifest path escapes its directory: ${value}`);
  }
  return target;
}

export async function readJson(path) {
  try { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/u, '')); }
  catch (error) { throw new Error(`Cannot read JSON ${path}: ${error.message}`, { cause: error }); }
}

export function validateManifest(value, mode = 'release') {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.plugins) || value.plugins.length < 1) {
    throw new Error('profile/manifest.json must have schemaVersion 1 and a nonempty plugins list.');
  }
  const names = value.plugins.map(plugin => plugin?.name);
  if (new Set(names).size !== names.length || names.some(name => !packageName(name))) {
    throw new Error('Manifest plugin names must be valid, unique npm package names.');
  }
  for (const plugin of value.plugins) {
    if (plugin.source !== undefined) portablePath(plugin.source);
    if (!exactVersion(plugin.version)) {
      throw new Error(`An exact version is required: ${plugin.name}`);
    }
    if (mode === 'source') {
      if (!plugin.source && !plugin.url) throw new Error(`Source directory or locked URL is required: ${plugin.name}`);
    } else {
      if (plugin.archive !== undefined) {
        portablePath(plugin.archive);
        if (!plugin.archive.startsWith('artifacts/') || !plugin.archive.endsWith('.tgz')) {
          throw new Error(`Archive must be an artifacts/*.tgz path: ${plugin.name}`);
        }
      } else if (!plugin.url) {
        throw new Error(`Local archive or locked URL is required: ${plugin.name}`);
      }
    }
    if (plugin.url !== undefined) archiveUrl(plugin.url);
    if ((mode !== 'source' || plugin.url || plugin.sha256 !== undefined) && !/^[a-f0-9]{64}$/u.test(plugin.sha256 ?? '')) {
      throw new Error(`Invalid SHA-256 lock: ${plugin.name}`);
    }
  }
  if (mode === 'release' && new Set(value.plugins.map(plugin => plugin.archive ?? plugin.url)).size !== value.plugins.length) {
    throw new Error('Every plugin requires a distinct archive.');
  }
  if (value.baseline !== undefined && (!['original', 'next'].includes(value.baseline?.host)
    || !exactVersion(value.baseline?.runtimeVersion) || !exactVersion(value.baseline?.applicationVersion))) {
    throw new Error('Baseline requires a host kind and exact runtime/application versions.');
  }
  return value;
}

/** Validate the product feature placement record shipped with a Profile. */
export function validateFeatureMatrix(value, plugins = []) {
  if (value?.schemaVersion !== 1 || !['original', 'next'].includes(value.fullFeatureHost)
    || !Array.isArray(value.features) || value.features.length < 1) {
    throw new Error('profile/feature-matrix.json must have schemaVersion 1, a fullFeatureHost and features.');
  }
  const ids = value.features.map(feature => feature?.id);
  if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id)) {
    throw new Error('Feature matrix ids must be nonempty and unique.');
  }
  const pluginNames = new Set(plugins.map(plugin => plugin.name));
  for (const feature of value.features) {
    if (typeof feature.name !== 'string' || !feature.name
      || !['plugin', 'plugin-candidate', 'source-required'].includes(feature.placement)
      || typeof feature.wholeFeaturePluginizable !== 'boolean'
      || typeof feature.status !== 'string') {
      throw new Error(`Invalid feature matrix entry: ${feature.id}`);
    }
    if (feature.placement === 'plugin' && (!packageName(feature.package) || !feature.wholeFeaturePluginizable)) {
      throw new Error(`Plugin feature is missing package: ${feature.id}`);
    }
    if (feature.placement === 'source-required' && feature.wholeFeaturePluginizable) {
      throw new Error(`A source-required feature cannot claim complete plugin support: ${feature.id}`);
    }
    if (feature.includedByDefault === true && !pluginNames.has(feature.package)) {
      throw new Error(`Default feature package is not in the release manifest: ${feature.id}`);
    }
  }
  return value;
}

export async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

/** Read local release locks without fetching archives or loading installed plugins. */
export async function readRelease(manifestPath) {
  const root = dirname(dirname(await realpath(manifestPath)));
  const manifest = validateManifest(await readJson(manifestPath));
  const records = {};
  for (const [field, label, validate] of [
    ['compatibility', 'Compatibility record', validateCompatibility],
    ['featureMatrix', 'Feature matrix', validateFeatureMatrix],
  ]) {
    const reference = manifest[field];
    if (!reference) continue;
    const path = await confinedPath(root, reference.path);
    if (!/^[a-f0-9]{64}$/u.test(reference.sha256 ?? '') || await sha256(path) !== reference.sha256) {
      throw new Error(`${label} SHA-256 mismatch.`);
    }
    records[field] = validate(await readJson(path), manifest.plugins);
  }
  return { root, manifest, plugins: manifest.plugins, ...records };
}

/** Resolve the exact archive bytes only when installing or validating a downloadable kit. */
export async function loadRelease(manifestPath, request = fetch) {
  const release = await readRelease(manifestPath);
  const plugins = [];
  for (const plugin of release.plugins) {
    if (!plugin.archive) {
      const archiveBytes = await downloadArchive(plugin, request);
      plugins.push({ ...plugin, archive: `artifacts/${archiveFilename(plugin)}`, archiveBytes });
      continue;
    }
    const archivePath = await confinedPath(release.root, plugin.archive);
    if (!(await stat(archivePath)).isFile() || await sha256(archivePath) !== plugin.sha256) {
      throw new Error(`Archive SHA-256 mismatch or invalid file: ${plugin.archive}`);
    }
    plugins.push({ ...plugin, archivePath });
  }
  return { ...release, plugins };
}
