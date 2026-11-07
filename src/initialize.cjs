/* Profile creation uses the same installed initializer and bundle template as Desktop. */
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { join } = require('node:path');

async function main() {
  const [appDir, profile] = process.argv.slice(2);
  const runtimeRequire = createRequire(join(appDir, 'resources', 'app.asar', 'dsh', 'package.json'));
  const load = name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
  const [{ initProfile }, { PROFILE_TEMPLATES }] = await Promise.all([
    load('@deepseek-ai/dsh-app-boot'), load('@deepseek-ai/dsh-official-bundles'),
  ]);
  if (typeof initProfile !== 'function' || !Array.isArray(PROFILE_TEMPLATES?.web?.bundles)) {
    throw new Error('The installed profile initializer is incompatible. Open Desktop once to initialize its profile, then retry.');
  }
  initProfile(profile, PROFILE_TEMPLATES.web.bundles);
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
