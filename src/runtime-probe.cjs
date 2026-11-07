/* Executed by installed Electron: its filesystem supports the signed app.asar. */
const fs = require('node:fs');
const path = require('node:path');

try {
  const [root, host] = process.argv.slice(2);
  if (!['original', 'next'].includes(host)) throw new Error('Select --host original or next.');
  const application = path.join(root, 'resources', 'app.asar');
  const manifest = JSON.parse(fs.readFileSync(path.join(application, 'package.json'), 'utf8'));
  const next = manifest.dshNext;
  if (host === 'next' && (manifest.name !== 'dsh-next-desktop' || manifest.productName !== 'DSH Next'
    || manifest.dshDesktopAppId !== 'io.github.xue-ding-e.dsh-next'
    || next?.schemaVersion !== 1 || next.repository !== 'xue-ding-e/DSH-Next'
    || next.repositoryId !== 1437727533 || next.updateMode !== 'auto')) {
    throw new Error('Select an installed DSH Next release; this application has no valid Next identity.');
  }
  if (host === 'original' && (manifest.name !== '@deepseek-ai/dsh-desktop' || next !== undefined
    || typeof manifest.dshDesktopAppId !== 'string' || manifest.dshDesktopAppId === 'io.github.xue-ding-e.dsh-next')) {
    throw new Error('Select the official DeepSeek Harness desktop installation; Next identity is not an original host.');
  }
  const runtime = JSON.parse(fs.readFileSync(path.join(application, 'dsh', 'desktop-runtime.json'), 'utf8'));
  if (runtime.schemaVersion !== 1 || runtime.platform !== 'win32' || typeof runtime.release?.version !== 'string') {
    throw new Error('Unsupported desktop-runtime.json. Install a current desktop release first.');
  }
  const cli = host === 'next' ? path.join(application, 'lib', 'next-cli-entry.js')
    : path.join(application, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');
  for (const file of [cli,
    path.join(root, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')]) {
    if (!fs.statSync(file).isFile()) throw new Error(`Missing installed runtime file: ${file}`);
  }
  console.log(JSON.stringify({ version: runtime.release.version, arch: runtime.arch,
    applicationVersion: manifest.version ?? null }));
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
