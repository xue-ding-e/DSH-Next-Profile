#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { install } from './install.mjs';
import { defaultManifest, diagnose } from './diagnose.mjs';
import { readRelease } from './manifest.mjs';

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    'app-dir': { type: 'string' }, home: { type: 'string' }, manifest: { type: 'string' },
    host: { type: 'string' }, isolated: { type: 'boolean' },
    check: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    json: { type: 'boolean' },
    'match-baseline': { type: 'boolean' },
  } });
  if (values.help) {
    console.log(`dsh-next-profile [--host original|next] [--app-dir <installed desktop directory>] [--home <host data directory>]
  [--manifest <release profile/manifest.json>] [--check | --dry-run] [--json]

Commands: install | check | doctor | features
install: initialize a pristine profile with the installed Host initializer, then install/repair the locked collection.
check: verify installed packages and selected bundles without downloading archives.
doctor: read-only host/package inventory; works while Desktop is running and never downloads archives.
features: print complete-feature placement decisions without inspecting Desktop or downloading archives.
--json: emit one JSON result on stdout; installation progress goes to stderr.
--match-baseline: require the exact host/runtime/application versions recorded by this Profile before writing.

Windows: install the selected desktop host, then fully quit it including the tray icon.
install can initialize a pristine profile; a partial profile needs recovery by opening Desktop once.
Uses the installed Electron/Node/pnpm, local verified archives, and the desktop profile.
Original host: DSH_HOME or %USERPROFILE%\\.dsh. Next host: DSH_NEXT_HOME or %USERPROFILE%\\.dsh-next.
The other host's home is protected. Multiple installations require explicit host selection.
--check: read-only; exit 0 only when all manifest dependencies and bundles are installed.
--dry-run: validate runtime, initialized profile, locks, paths and hashes without writes.
--isolated: controlled verification with explicit --host, --app-dir and a separate --home.
Provider authorization and local resources are configured separately after installation.`);
    return;
  }
  if (values.host && !['original', 'next'].includes(values.host)) throw new Error('--host must be original or next.');
  if (values.check && values['dry-run']) throw new Error('Choose either --check or --dry-run.');
  const command = positionals[0] ?? (values.check ? 'check' : 'install');
  if (positionals.length > 1 || !['install', 'check', 'doctor', 'features'].includes(command)) {
    throw new Error('Choose install, check, doctor or features.');
  }
  if (['doctor', 'features'].includes(command) && (values.check || values['dry-run'])) {
    throw new Error(`${command} cannot be combined with --check or --dry-run.`);
  }
  if (command === 'check' && values['dry-run']) throw new Error('Choose either check or --dry-run.');
  const options = { host: values.host, appDir: values['app-dir'], home: values.home, isolated: values.isolated,
    manifest: values.manifest ? resolve(values.manifest) : defaultManifest,
    check: command === 'check' || values.check, dryRun: values['dry-run'], json: values.json, matchBaseline: values['match-baseline'],
    initialize: command === 'install' && !values.check && !values['dry-run'] };
  const print = value => console.log(JSON.stringify(value, null, 2));
  if (command === 'features') {
    const release = await readRelease(options.manifest);
    if (!release.featureMatrix) throw new Error('This release has no feature matrix. Use a current Profile release.');
    if (values.json) print(release.featureMatrix);
    else {
      console.log(`Complete feature set requires host=${release.featureMatrix.fullFeatureHost}.`);
      for (const feature of release.featureMatrix.features) {
        console.log(`${feature.id}: ${feature.placement} (${feature.status})${feature.package ? `; package=${feature.package}` : ''}`);
        if (feature.reason) console.log(`  ${feature.reason}`);
      }
    }
    return { ok: true };
  }
  if (process.platform !== 'win32') throw new Error('Installed Desktop operations require Windows. features is available on any platform.');
  if (command === 'doctor') {
    const report = await diagnose(options);
    const ok = report.codeInstalled && (!values['match-baseline'] || report.baselineMatches === true);
    if (values.json) print({ ok, ...report });
    else {
      console.log(`Host: ${report.host} ${report.runtimeVersion}; application=${report.applicationVersion ?? 'unknown'}\nProfile: ${report.profile}\nInitialized: ${report.initialized}; plugin code installed: ${report.codeInstalled}`);
      if (report.baseline) console.log(`Skeleton baseline: ${report.baseline.host} ${report.baseline.applicationVersion}; matches=${report.baselineMatches}`);
      for (const row of report.rows) console.log(`${row.name}@${row.version}: installed=${row.installedVersion ?? 'missing'}, files=${row.installed}, bundle=${row.enabled}`);
      if (report.hostMatchesFeatureSet === false) console.log('This host provides the plugin subset. Source-owned Next features require DSH Next.');
      for (const setup of report.setup) console.log(`Setup (${setup.package}): ${setup.action}`);
      console.log('Runtime, GUI and provider authorization are not verified by doctor.');
    }
    return { ok, report };
  }
  const result = await install(options, { log: values.json ? message => console.error(message) : console.log });
  if (values.json) print({ ok: true, ...result });
  return { ok: true, result };
}

if (import.meta.main) main().then(result => { if (result?.ok === false) process.exitCode = 1; }).catch(error => {
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: error.message }));
  else console.error(error.stack || error.message);
  process.exitCode = 1;
});
