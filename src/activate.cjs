/* Only the signed runtime's own writer lock and atomic replacement may enable bundles. */
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { join } = require('node:path');
const { readFile } = require('node:fs/promises');

async function main() {
  const [appDir, profile, ...names] = process.argv.slice(2);
  const runtime = join(appDir, 'resources', 'app.asar', 'dsh');
  const runtimeRequire = createRequire(join(runtime, 'package.json'));
  let atomic;
  try { atomic = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-atomic-write')).href); }
  catch (error) { throw new Error('This host cannot safely enable retained disabled bundles: its @deepseek-ai/dsh-atomic-write helper is unavailable. Enable the selected plugins in the host plugin manager or update the host.', { cause: error }); }
  const { withFileLock, writeFileAtomic } = atomic;
  if (typeof withFileLock !== 'function' || typeof writeFileAtomic !== 'function') throw new Error('The installed host atomic writer API is incompatible. Update this host before enabling retained disabled bundles.');
  const path = join(profile, 'package.json');
  await withFileLock(path, async () => {
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    const bundles = manifest.dsh?.profile?.bundles;
    if (!Array.isArray(bundles)) throw new Error('Desktop profile has no bundle selection.');
    let changed = false;
    for (const name of names) {
      if (typeof manifest.dependencies?.[name] !== 'string') throw new Error(`Missing installed dependency: ${name}`);
      const metadata = JSON.parse(await readFile(join(profile, 'node_modules', name, 'package.json'), 'utf8'));
      if (!metadata.dsh?.bundle?.patch) throw new Error(`Package is not a DSH bundle: ${name}`);
      if (!bundles.includes(name)) { bundles.push(name); changed = true; }
    }
    if (changed) await writeFileAtomic(path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  }, { waitMs: 2000 });
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
