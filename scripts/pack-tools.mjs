import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, cleanEnvironment } from '../src/process.mjs';
import { archiveFilename, confinedPath, portablePath, readJson } from '../src/manifest.mjs';
import { downloadArchive } from '../src/archives.mjs';
import { assertNoSecrets } from './release-safety.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Use npm's maintained packlist and tar writer; never execute vendor lifecycle scripts. */
export async function npm(args, cwd) {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].filter(Boolean);
  let cli;
  for (const candidate of candidates) {
    if (!/npm-cli\.(?:c?js|mjs)$/u.test(candidate)) continue;
    try { await access(candidate); cli = candidate; break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!cli) throw new Error('Build requires npm (npm-cli.js next to Node, or npm_execpath). End users use DSH Next bundled tools.');
  return execute(process.execPath, [cli, ...args], { cwd, env: { ...cleanEnvironment(), npm_config_cache: join(root, 'scripts', '.work', 'npm-cache'), npm_config_update_notifier: 'false', npm_config_audit: 'false' }, timeout: 120_000 });
}

export function assertPublicFile(name, bytes) {
  assertNoSecrets(name, bytes);
  if (/(?:^|\/)(?:auth\.json|credentials(?:\.[^/]*)?|tokens?\.(?:json|ya?ml|txt)|\.env(?:\.[^/]*)?|\.npmrc|\.git|\.dsh(?:-next)?|\.bsk|node_modules|User Data|Local Storage|Cookies|Login Data|Web Data)(?:\/|$)/iu.test(name)
    || /\.(?:sqlite3?|db|jsonl|p12|pfx|pem)$/iu.test(name)) {
    throw new Error(`Personal/configuration file cannot be packaged: ${name}`);
  }
  if (/\.(?:[cm]?js|ts|json|ya?ml|md|txt|map|html|ps1|cmd)$/iu.test(name)) {
    const text = bytes.toString('utf8');
    if (/\b[A-Z]:[\\/]+(?:_code|software)(?:[\\/]|$)/iu.test(text)) {
      throw new Error(`Personal checkout path in: ${name}`);
    }
    if (/(?:^|\/)dsh-bsk-bridge\/cordis\.patch\.yml$/u.test(name)) {
      const binding = /^\s*browser:\s*([^#\r\n]*)/mu.exec(text)?.[1]?.trim();
      if (binding && !["''", '""', 'null', '~'].includes(binding)) {
        throw new Error(`Release BSK browser must remain unbound: ${name}`);
      }
    }
  }
}

export async function copyPublicFile(fromRoot, toRoot, name, label = name) {
  const source = await confinedPath(fromRoot, portablePath(name));
  if (!(await stat(source)).isFile()) throw new Error(`Not a regular file: ${source}`);
  assertPublicFile(label, await readFile(source));
  const destination = join(toRoot, name);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

export async function inventory(directory) {
  const result = await npm(['pack', '--dry-run', '--ignore-scripts', '--json'], directory);
  const [pack] = JSON.parse(result.stdout);
  if (!Array.isArray(pack?.files)) throw new Error('npm pack did not return a file inventory.');
  return pack;
}

export function releaseMetadata(metadata) {
  const result = { ...metadata };
  for (const field of ['scripts', 'devDependencies', 'packageManager', 'workspaces', 'pnpm', 'publishConfig', 'private']) delete result[field];
  result.files = metadata.files;
  if (!result.license) throw new Error(`Missing license declaration: ${result.name}`);
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, spec] of Object.entries(result[field] ?? {})) {
      if (typeof spec !== 'string' || /(?:workspace:|link:|file:|git\+|github:|[\\]|^[./]|^~\/|^[a-z]:)/iu.test(spec)) {
        throw new Error(`Nonportable ${field}: ${name}=${spec}`);
      }
    }
  }
  return result;
}

export async function packPlugin(sources, plugin, work, artifacts) {
  const vendor = await confinedPath(sources, plugin.source);
  const metadata = await readJson(await confinedPath(vendor, 'package.json'));
  if (metadata.name !== plugin.name) throw new Error(`Vendor package name mismatch: ${plugin.name}`);
  if (metadata.version !== plugin.version) throw new Error(`Locked source version mismatch: ${plugin.name}`);
  const staged = join(work, 'packages', plugin.name);
  await mkdir(dirname(staged), { recursive: true });
  await mkdir(staged);
  const pack = await inventory(vendor);
  for (const { path } of pack.files) {
    if (path === 'package.json' || /^(?:tests?|\.github|node_modules)\//u.test(path)) continue;
    await copyPublicFile(vendor, staged, path, `${plugin.name}/${path}`);
  }
  const sanitized = releaseMetadata(metadata);
  await writeFile(join(staged, 'package.json'), `${JSON.stringify(sanitized, null, 2)}\n`);
  const { validatePackageFiles } = await import('./smoke-package.mjs');
  await validatePackageFiles(staged, sanitized);
  const packedDirectory = join(work, 'tarballs', plugin.name);
  await mkdir(packedDirectory, { recursive: true });
  const result = await npm(['pack', '--ignore-scripts', '--json', '--pack-destination', packedDirectory], staged);
  const [archive] = JSON.parse(result.stdout);
  if (!archive?.filename || !archive.files?.length) throw new Error(`npm pack failed for ${plugin.name}`);
  const filename = archiveFilename(plugin);
  await copyFile(join(packedDirectory, archive.filename), join(artifacts, filename));
  return { name: plugin.name, version: metadata.version, archive: `artifacts/${filename}` };
}

/** System libarchive/GNU tar inspect and extract remote tgz files; links are never accepted. */
export async function unpackLockedArchive(plugin, work, request) {
  const bytes = await downloadArchive(plugin, request);
  const archive = join(work, archiveFilename(plugin));
  await writeFile(archive, bytes, { flag: 'wx' });
  return inspectPluginArchive(archive, plugin, work);
}

/** Inspect already frozen tgz bytes without repacking or running package scripts. */
export async function inspectPluginArchive(archive, plugin, work) {
  const list = await execute('tar', ['-tzf', archive]);
  const names = list.stdout.trim().split(/\r?\n/u);
  if (new Set(names.map(name => name.replace(/\/$/u, ''))).size !== names.length) throw new Error(`Archive contains duplicate entries: ${plugin.name}`);
  for (const name of names) {
    portablePath(name.replace(/\/$/u, ''));
    if (name !== 'package/' && !name.startsWith('package/')) throw new Error(`Archive has a non-package path: ${plugin.name}`);
  }
  const detail = await execute('tar', ['-tvzf', archive]);
  if (detail.stdout.trim().split(/\r?\n/u).some(line => !/^[d-]/u.test(line))) {
    throw new Error(`Archive contains links or special entries: ${plugin.name}`);
  }
  const extracted = join(work, `download-${archiveFilename(plugin)}`);
  await mkdir(extracted);
  await execute('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '-C', extracted]);
  const packageRoot = join(extracted, 'package');
  const scan = async (directory, prefix = '') => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await scan(join(directory, entry.name), `${name}/`);
      else assertPublicFile(`${plugin.name}/${name}`, await readFile(join(directory, entry.name)));
    }
  };
  await scan(packageRoot);
  const metadata = await readJson(await confinedPath(packageRoot, 'package.json'));
  if (metadata.name !== plugin.name || metadata.version !== plugin.version) throw new Error(`Downloaded package identity mismatch: ${plugin.name}`);
  if (metadata.scripts || metadata.devDependencies) throw new Error(`Locked tgz must already be built without scripts/development dependencies: ${plugin.name}`);
  const { validatePackageFiles } = await import('./smoke-package.mjs');
  await validatePackageFiles(packageRoot, metadata);
  return { archivePath: archive, filename: archiveFilename(plugin) };
}

export { root };
