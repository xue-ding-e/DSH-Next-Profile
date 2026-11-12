import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanEnvironment, execute } from '../src/process.mjs';
import { powershell } from '../src/runtime.mjs';
import { fixture, repository } from './fixtures.mjs';

test('release publication uploads stable aliases and checksums before making the draft latest', {
  skip: process.platform !== 'win32',
}, async t => {
  const root = await fixture(t);
  const version = '1.2.3';
  for (const directory of ['.output/full', '.output/thin', 'profile', 'installer']) await mkdir(join(root, directory), { recursive: true });
  const files = {
    'package.json': JSON.stringify({ version }),
    '.output/full/dsh-next-profile-1.2.3.tgz': 'full tgz',
    '.output/full/dsh-next-profile-1.2.3-windows.zip': 'full zip',
    '.output/thin/dsh-next-profile-1.2.3.tgz': 'thin tgz',
    'profile/manifest.json': '{}', 'profile/compatibility.json': '{}', 'profile/feature-matrix.json': '{}',
    'installer/Install-Latest.ps1': 'bootstrap script',
  };
  for (const [name, value] of Object.entries(files)) await writeFile(join(root, name), value);
  const workflow = (await readFile(join(repository, '.github/workflows/release.yml'), 'utf8')).replaceAll('\r\n', '\n');
  const step = workflow.split('      - name: Create GitHub Release')[1];
  const script = step.split('        run: |\n')[1].split('\n').map(line => line.replace(/^ {10}/u, '')).join('\n');
  const driver = join(root, 'publish.ps1');
  await writeFile(driver, '\uFEFF' + [
    "$ErrorActionPreference = 'Stop'",
    "Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')",
    'function Invoke-RestMethod {',
    '  param($Method, $Uri, $Headers, $ContentType, $Body, $InFile)',
    '  $payload = if ($Body) { [Text.Encoding]::UTF8.GetString($Body) } else { $null }',
    '  @{ method = $Method; uri = $Uri; body = $payload; file = $InFile } | ConvertTo-Json -Compress | Add-Content -LiteralPath $env:DSH_RELEASE_REQUESTS',
    '  if ($InFile -and $env:DSH_RELEASE_FAIL) { throw "fixture upload failure" }',
    '  return @{ url = "https://api.github.com/repos/fixture/profile/releases/123"; upload_url = "https://uploads.github.com/repos/fixture/profile/releases/123/assets{?name,label}" }',
    '}', script,
  ].join('\n') + '\n');
  const requestsFile = join(root, 'requests.jsonl');
  const env = { ...cleanEnvironment(), RELEASE_DIR: '.output/release', GITHUB_REF_NAME: 'v' + version,
    GITHUB_SHA: 'fixture-commit', GITHUB_REPOSITORY: 'fixture/profile', GITHUB_TOKEN: 'fixture-only',
    DSH_RELEASE_REQUESTS: requestsFile };
  await execute(powershell(), ['-NoProfile', '-NonInteractive', '-File', driver], { cwd: root, env });
  const requests = (await readFile(requestsFile, 'utf8')).trim().split(/\r?\n/u).map(line => JSON.parse(line.replace(/^\uFEFF/u, '')));
  assert.equal(JSON.parse(requests[0].body).draft, true);
  assert.deepEqual(JSON.parse(requests.at(-1).body), { draft: false, make_latest: 'true' });
  assert.equal(requests.at(-1).method, 'Patch');
  assert.equal(requests.filter(row => row.file).length, 10);
  const output = join(root, '.output/release');
  assert.deepEqual(await readFile(join(output, 'dsh-next-profile.tgz')), await readFile(join(output, 'dsh-next-profile-1.2.3.tgz')));
  assert.deepEqual(await readFile(join(output, 'dsh-next-profile-windows.zip')), await readFile(join(output, 'dsh-next-profile-1.2.3-windows.zip')));
  const checksums = (await readFile(join(output, 'SHA256SUMS'), 'utf8')).trim().split('\n');
  assert.equal(checksums.length, 9);
  for (const line of checksums) {
    const [digest, name] = line.split('  ');
    assert.equal(digest, createHash('sha256').update(await readFile(join(output, name))).digest('hex'));
  }
  const failedRequests = join(root, 'failed-requests.jsonl');
  await assert.rejects(execute(powershell(), ['-NoProfile', '-NonInteractive', '-File', driver], {
    cwd: root, env: { ...env, RELEASE_DIR: '.output/failed-release', DSH_RELEASE_REQUESTS: failedRequests, DSH_RELEASE_FAIL: '1' },
  }), /fixture upload failure/u);
  assert.doesNotMatch(await readFile(failedRequests, 'utf8'), /"method":"Patch"/u);
});
