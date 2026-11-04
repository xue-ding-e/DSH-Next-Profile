import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execute } from '../src/process.mjs';
import { fixture, json, repository } from './fixtures.mjs';

test('original identity is accepted only in original mode without a Next fallback', async t => {
  const root = await fixture(t);
  const app = join(root, 'resources', 'app.asar');
  const cli = join(app, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');
  const pnpm = join(root, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs');
  for (const file of [cli, pnpm]) { await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, ''); }
  await json(join(app, 'package.json'), { name: '@deepseek-ai/dsh-desktop', dshDesktopAppId: 'test.original.desktop' });
  await json(join(app, 'dsh', 'desktop-runtime.json'), { schemaVersion: 1, platform: 'win32', arch: 'x64', release: { version: '1.0.0' } });
  const probe = join(repository, 'src', 'runtime-probe.cjs');
  assert.equal(JSON.parse((await execute(process.execPath, [probe, root, 'original'])).stdout).version, '1.0.0');
  await assert.rejects(execute(process.execPath, [probe, root, 'next']), /Next identity/u);
  await json(join(app, 'package.json'), { name: '@deepseek-ai/dsh-desktop', dshDesktopAppId: 'test.original.desktop', dshNext: {} });
  await assert.rejects(execute(process.execPath, [probe, root, 'original']), /not an original host/u);
});
