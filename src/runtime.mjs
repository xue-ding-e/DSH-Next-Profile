import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, cleanEnvironment } from './process.mjs';
import { within } from './manifest.mjs';
import { HOSTS, hostIdentity } from './hosts.mjs';

const source = dirname(fileURLToPath(import.meta.url));
export const powershell = () => join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

export async function discoverApp(host) {
  const result = await execute(powershell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', join(source, '..', 'installer', 'Find-DshNext.ps1'), ...(host ? ['-HostKind', host] : [])]);
  const candidates = JSON.parse(result.stdout.replace(/^\uFEFF/u, '').trim());
  const valid = [];
  for (const candidate of candidates) {
    try { valid.push(await inspectRuntime(candidate.appDir, candidate.host)); }
    catch (error) { console.error(`Skipping ${candidate.appDir}: ${error.message}`); }
  }
  if (valid.length !== 1) throw new Error(`Found ${valid.length} valid installations. Select --host original|next and --app-dir <installation directory>.`);
  return valid[0];
}

export async function inspectRuntime(appDir, host) {
  const root = await realpath(resolve(appDir));
  if (!host) {
    const candidates = [];
    for (const [kind, identity] of Object.entries(HOSTS)) {
      try { if ((await stat(join(root, identity.executable))).isFile()) candidates.push(kind); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (candidates.length !== 1) throw new Error('Select --host original|next for this installation directory.');
    [host] = candidates;
  }
  const identity = hostIdentity(host);
  const executable = join(root, identity.executable);
  const node = join(root, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe');
  if (!(await stat(node)).isFile()) throw new Error(`Bundled Node is missing: ${node}. Reinstall ${identity.product}.`);
  const env = { ...cleanEnvironment(), ELECTRON_RUN_AS_NODE: '1' };
  const result = await execute(executable, ['--expose-internals', join(source, 'runtime-probe.cjs'), root, host], { env });
  const metadata = JSON.parse(result.stdout.trim());
  return { root, executable, node, host, product: identity.product, version: metadata.version,
    applicationVersion: metadata.applicationVersion,
    cli: join(root, 'resources', 'app.asar', ...identity.cli) };
}

/** Resolve actual existing ancestors, including junctions into an upstream home. */
export async function canonicalPath(value) {
  const absolute = resolve(value);
  try { return await realpath(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(await canonicalPath(parent), absolute.slice(parent.length));
  }
}

export async function resolveHome(configured, appDir, environment = process.env, userHome = homedir(), host = 'next') {
  const identity = hostIdentity(host);
  const selected = configured || (host === 'next' ? environment.DSH_NEXT_HOME?.trim() :
    (environment.DSH_NEXT_ACTIVE_HOME && environment.DSH_HOME === environment.DSH_NEXT_ACTIVE_HOME
      ? environment.DSH_NEXT_UPSTREAM_HOME : environment.DSH_HOME)?.trim()) || join(userHome, identity.home);
  if (!isAbsolute(selected)) throw new Error('--home / DSH_NEXT_HOME must be an absolute path.');
  const target = await canonicalPath(selected);
  const protectedRoots = [join(userHome, host === 'next' ? '.dsh' : '.dsh-next'), appDir];
  const inherited = environment.DSH_NEXT_ACTIVE_HOME === environment.DSH_HOME
    ? environment.DSH_NEXT_UPSTREAM_HOME : environment.DSH_HOME;
  if (host === 'next' && inherited?.trim()) protectedRoots.push(inherited);
  if (host === 'original' && environment.DSH_NEXT_HOME?.trim()) protectedRoots.push(environment.DSH_NEXT_HOME);
  if (host === 'original' && environment.DSH_NEXT_ACTIVE_HOME?.trim()) protectedRoots.push(environment.DSH_NEXT_ACTIVE_HOME);
  for (const protectedRoot of protectedRoots) {
    const root = await canonicalPath(protectedRoot);
    if (within(root, target) || within(target, root) || target === parse(target).root) {
      throw new Error(`Use a separate ${identity.product} home; refusing protected directory: ${target}`);
    }
  }
  return target;
}

export function installationEnvironment(home, environment = process.env, host = 'next') {
  if (host === 'original') {
    const env = cleanEnvironment(environment);
    for (const key of Object.keys(env)) if (/^DSH_NEXT_/iu.test(key)) delete env[key];
    return { ...env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1' };
  }
  hostIdentity(host);
  const inheritedNext = environment.DSH_NEXT_ACTIVE_HOME === environment.DSH_HOME && environment.DSH_NEXT_UPSTREAM_HOME;
  return { ...cleanEnvironment(environment), DSH_HOME: home, DSH_NEXT_HOME: home,
    DSH_NEXT_ACTIVE_HOME: home,
    DSH_NEXT_UPSTREAM_HOME: inheritedNext || environment.DSH_HOME || join(homedir(), '.dsh'),
    ELECTRON_RUN_AS_NODE: '1' };
}

export async function validateIsolation(options, home, runtime, environment = process.env, userHome = homedir()) {
  if (!options.isolated) return;
  if (!options.home || !options.appDir || !options.host) throw new Error('--isolated requires explicit --host, --app-dir and --home.');
  const known = [join(userHome, '.dsh'), join(userHome, '.dsh-next'),
    environment.DSH_HOME, environment.DSH_NEXT_HOME, environment.DSH_NEXT_UPSTREAM_HOME, environment.DSH_NEXT_ACTIVE_HOME].filter(Boolean);
  for (const value of known) {
    const root = await canonicalPath(value);
    if (within(root, home) || within(home, root)) throw new Error('--isolated needs a separate home outside both normal desktop data directories.');
  }
}

export async function assertStoppedProcesses(appDir, processes, isolated = false) {
  if (!processes.length) return;
  if (!isolated) throw new Error('Fully quit the selected desktop host (including its tray icon) before installing.');
  const selected = await canonicalPath(appDir);
  for (const process of processes) {
    if (!process.executable || within(selected, await realpath(process.executable))) {
      throw new Error('Fully quit the selected private desktop host; its executable or process ownership could not be excluded.');
    }
  }
}

export async function assertAppStopped(appDir, host = 'next', options = {}) {
  const identity = hostIdentity(host);
  const result = await execute(powershell(), ['-NoProfile', '-NonInteractive', '-Command',
    `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $running=@(Get-Process -Name '${identity.product}' -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{pid=$_.Id;executable=$_.Path} }); ConvertTo-Json -InputObject $running -Compress`]);
  try { await assertStoppedProcesses(appDir, JSON.parse(result.stdout.trim()), options.isolated); }
  catch (error) { throw new Error(`${error.message} Host: ${identity.product}. Installation: ${appDir}`, { cause: error }); }
}
