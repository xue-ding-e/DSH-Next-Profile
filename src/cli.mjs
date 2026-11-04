#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { install } from './install.mjs';

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, allowPositionals: false, options: {
    'app-dir': { type: 'string' }, home: { type: 'string' }, manifest: { type: 'string' },
    host: { type: 'string' }, isolated: { type: 'boolean' },
    check: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log(`dsh-next-profile [--host original|next] [--app-dir <installed desktop directory>] [--home <host data directory>]
  [--manifest <release profile/manifest.json>] [--check | --dry-run]

Windows: install and start the selected desktop host once, then fully quit it including the tray icon.
Uses the installed Electron/Node/pnpm, local verified archives, and the desktop profile.
Original host: DSH_HOME or %USERPROFILE%\\.dsh. Next host: DSH_NEXT_HOME or %USERPROFILE%\\.dsh-next.
The other host's home is protected. Multiple installations require explicit host selection.
--check: read-only; exit 0 only when all manifest dependencies and bundles are installed.
--dry-run: validate runtime, initialized profile, locks, paths and hashes without writes.
--isolated: controlled verification with explicit --host, --app-dir and a separate --home.
Provider authorization and local resources are configured separately after installation.`);
    return;
  }
  if (process.platform !== 'win32') throw new Error('This installer supports installed DeepSeek Harness / DSH Next on Windows. Build artifacts can be produced on other platforms.');
  if (values.host && !['original', 'next'].includes(values.host)) throw new Error('--host must be original or next.');
  if (values.check && values['dry-run']) throw new Error('Choose either --check or --dry-run.');
  await install({ host: values.host, appDir: values['app-dir'], home: values.home, isolated: values.isolated,
    manifest: values.manifest ? resolve(values.manifest) : fileURLToPath(new URL('../profile/manifest.json', import.meta.url)),
    check: values.check, dryRun: values['dry-run'] });
}

if (import.meta.main) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
