import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertStoppedProcesses, validateIsolation } from '../src/runtime.mjs';
import { fixture } from './fixtures.mjs';

test('isolated verification requires explicit host/runtime/home and excludes normal homes', async t => {
  const root = await fixture(t);
  const options = { isolated: true, host: 'next', appDir: join(root, 'private-app'), home: join(root, 'test-home') };
  const runtime = { root: options.appDir };
  await validateIsolation(options, options.home, runtime, {}, root);
  await assert.rejects(validateIsolation({ isolated: true }, options.home, runtime, {}, root), /explicit/u);
  await assert.rejects(validateIsolation(options, join(root, '.dsh-next'), runtime, {}, root), /separate home/u);
  await assert.rejects(validateIsolation(options, options.home, runtime, { DSH_NEXT_HOME: options.home }, root), /separate home/u);
});

test('only isolated verification can exclude another installation; selected or unknown ownership blocks', async t => {
  const root = await fixture(t);
  const selected = join(root, 'private-app');
  const other = join(root, 'installed-app');
  await mkdir(selected); await mkdir(other);
  const selectedExe = join(selected, 'DSH Next.exe');
  const otherExe = join(other, 'DSH Next.exe');
  await writeFile(selectedExe, 'fixture'); await writeFile(otherExe, 'fixture');
  await assert.rejects(assertStoppedProcesses(selected, [{ executable: otherExe }]), /Fully quit/u);
  await assertStoppedProcesses(selected, [{ executable: otherExe }], true);
  await assert.rejects(assertStoppedProcesses(selected, [{ executable: selectedExe }], true), /Fully quit/u);
  await assert.rejects(assertStoppedProcesses(selected, [{ executable: null }], true), /ownership/u);
});
