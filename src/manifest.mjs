import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
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
  return value;
}

export async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function loadRelease(manifestPath, request = fetch) {
  const { dirname } = await import('node:path');
  const root = dirname(dirname(await realpath(manifestPath)));
  const manifest = validateManifest(await readJson(manifestPath));
  const plugins = [];
  for (const plugin of manifest.plugins) {
    if (!plugin.archive) {
      const archiveBytes = await downloadArchive(plugin, request);
      plugins.push({ ...plugin, archive: `artifacts/${archiveFilename(plugin)}`, archiveBytes });
      continue;
    }
    const archivePath = await confinedPath(root, plugin.archive);
    if (!(await stat(archivePath)).isFile() || await sha256(archivePath) !== plugin.sha256) {
      throw new Error(`Archive SHA-256 mismatch or invalid file: ${plugin.archive}`);
    }
    plugins.push({ ...plugin, archivePath });
  }
  let compatibility;
  if (manifest.compatibility) {
    const file = await confinedPath(root, manifest.compatibility.path);
    if (!/^[a-f0-9]{64}$/u.test(manifest.compatibility.sha256 ?? '') || await sha256(file) !== manifest.compatibility.sha256) {
      throw new Error('Compatibility record SHA-256 mismatch.');
    }
    compatibility = validateCompatibility(await readJson(file), plugins);
  }
  return { root, plugins, compatibility };
}
