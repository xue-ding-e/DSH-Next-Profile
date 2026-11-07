import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { archiveFilename, PLUGINS, within } from '../src/manifest.mjs';

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function json(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function fixture(t) {
  const parent = join(repository, 'tests', '.tmp');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'case-'));
  t.after(async () => {
    if (!within(parent, root)) throw new Error('Invalid test cleanup path');
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

export async function installerFixture(t, names = PLUGINS) {
  const root = await fixture(t);
  const release = join(root, 'release space 中文');
  const home = join(root, 'home', '.dsh-next');
  const profile = join(home, 'profiles', 'desktop');
  await mkdir(join(release, 'artifacts'), { recursive: true });
  const plugins = [];
  for (const name of names) {
    const bytes = Buffer.from(`Archive fixture: ${name}\n`);
    const archive = `artifacts/${archiveFilename({ name, version: '1.0.0' })}`;
    await writeFile(join(release, archive), bytes);
    plugins.push({ name, version: '1.0.0', archive, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const manifest = join(release, 'profile', 'manifest.json');
  await json(manifest, { schemaVersion: 1, plugins });
  await json(join(profile, 'package.json'), { private: true, dependencies: { retained: '1.0.0' },
    dsh: { profile: { bundles: ['retained-bundle'] } }, untouched: 'keep me' });
  await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\n');
  await json(join(home, 'auth.json'), { sentinel: 'untouched account fixture' });
  const appDir = join(root, 'installed app');
  await mkdir(appDir);
  const runtime = { root: appDir, host: 'next', executable: join(appDir, 'DSH Next.exe'), cli: join(appDir, 'resources', 'app.asar', 'lib', 'next-cli-entry.js'), version: '0.2.1-rc.3' };
  return { root, release, manifest, home, profile, plugins, runtime };
}

export function fakeRuntime(fixture, { fail = false, omit = false, disabled = false } = {}) {
  const calls = [];
  const execute = async (command, args, options) => {
    calls.push({ command, args, options });
    const path = join(fixture.profile, 'package.json');
    if (args[1]?.endsWith('initialize.cjs')) {
      await json(path, { private: true, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } });
      await writeFile(join(fixture.profile, 'cordis.patch.yml'), '[]\n');
      await writeFile(join(fixture.profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\n');
      return { stdout: '', stderr: '' };
    }
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    if (args.includes('add')) {
      if (fail) throw new Error('fixture pnpm failed with exit 17');
      for (const plugin of fixture.plugins) {
        manifest.dependencies[plugin.name] = `file:${args.find(arg => arg.endsWith(`-${archiveFilename(plugin)}`))}`;
        if (omit && plugin.name === PLUGINS[0]) continue;
        const directory = join(fixture.profile, 'node_modules', plugin.name);
        await json(join(directory, 'package.json'), { name: plugin.name, version: plugin.version, main: 'lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } });
        await mkdir(join(directory, 'lib'), { recursive: true });
        await writeFile(join(directory, 'lib', 'index.js'), 'export {};\n');
        await writeFile(join(directory, 'cordis.patch.yml'), '[]\n');
      }
    } else if (!disabled) {
      for (const { name } of fixture.plugins) if (!manifest.dsh.profile.bundles.includes(name)) manifest.dsh.profile.bundles.push(name);
    }
    await json(path, manifest);
    return { stdout: '', stderr: '' };
  };
  return { calls, execute, runtime: fixture.runtime, assertStopped: async () => {}, log: () => {} };
}

async function copyTree(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isDirectory()) await copyTree(join(source, entry.name), join(destination, entry.name));
    else await copyFile(join(source, entry.name), join(destination, entry.name));
  }
}

export async function buildFixture(t, names = PLUGINS) {
  const root = await fixture(t);
  const repo = join(root, 'repository 中文');
  for (const directory of ['src', 'installer']) await copyTree(join(repository, directory), join(repo, directory));
  for (const file of ['package.json', 'README.md', 'README.zh.md']) await copyFile(join(repository, file), join(repo, file));
  await writeFile(join(repo, 'LICENSE'), 'Fixture installer license\n');
  for (const name of names) {
    const directory = join(repo, 'vendor', name);
    await mkdir(join(directory, 'lib'), { recursive: true });
    await writeFile(join(directory, 'lib', 'index.js'), 'export default {};\n');
    await writeFile(join(directory, 'cordis.patch.yml'), '[]\n');
    await writeFile(join(directory, 'LICENSE'), 'Fixture license\n');
    await json(join(directory, 'package.json'), { name, version: '1.0.0', type: 'module', license: 'MIT',
      main: 'lib/index.js', exports: { '.': './lib/index.js' }, files: ['lib', 'cordis.patch.yml', 'LICENSE'],
      dsh: { bundle: { patch: './cordis.patch.yml' } }, dependencies: { 'example-runtime': '^1.0.0' },
      devDependencies: { 'example-compiler': '1.0.0' }, scripts: { prepare: 'exit 99', prepack: 'exit 99' } });
  }
  const manifestPath = join(repo, 'profile', 'manifest.json');
  await json(manifestPath, { schemaVersion: 1, plugins: names.map(name => ({ name, version: '1.0.0', source: `vendor/${name}` })) });
  return { root, repo, manifestPath };
}
