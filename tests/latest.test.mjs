import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanEnvironment, execute } from '../src/process.mjs';
import { powershell } from '../src/runtime.mjs';
import { fixture, json, repository } from './fixtures.mjs';
import { npm, pnpm } from '../scripts/pack-tools.mjs';

const windows = { skip: process.platform !== 'win32' };

test('package smoke finds the launching pnpm without a global shim or PNPM_HOME', {
  skip: !/(?:^|[\\/])pnpm\.(?:cjs|mjs|js)$/u.test(process.env.npm_execpath ?? ''),
}, async t => {
  const root = await fixture(t);
  const moduleUrl = pathToFileURL(join(repository, 'scripts', 'pack-tools.mjs')).href;
  const code = 'import { pnpm } from ' + JSON.stringify(moduleUrl)
    + '; process.stdout.write((await pnpm(["--version"], process.cwd())).stdout);';
  const env = Object.fromEntries(Object.entries(cleanEnvironment()).filter(([key]) =>
    !/^(?:path|pnpm_home|pnpm_cli_path)$/iu.test(key)));
  const result = await execute(process.execPath, ['--input-type=module', '--eval', code], { cwd: root, env: { ...env, PATH: '' } });
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+(?:-.+)?$/u);
});

test('the documented pnpm command fetches changed bytes behind the same latest asset URL', { timeout: 60_000 }, async t => {
  const root = await fixture(t);
  const source = join(root, 'source');
  const cache = join(root, 'cache');
  const archives = join(root, 'archives');
  await mkdir(source);
  await mkdir(archives);
  let bytes;
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(bytes);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const asset = 'http://127.0.0.1:' + server.address().port + '/latest.tgz';
  for (const version of ['1.0.0', '1.0.1']) {
    await json(join(source, 'package.json'), { name: 'dsh-profile-latest-test', version, type: 'module', bin: { 'latest-test': 'bin.mjs' } });
    await writeFile(join(source, 'bin.mjs'), '#!/usr/bin/env node\nconsole.log(' + JSON.stringify(version) + ');\n');
    const packed = await npm(['pack', '--ignore-scripts', '--json', '--pack-destination', archives], source);
    bytes = await readFile(join(archives, JSON.parse(packed.stdout)[0].filename));
    const result = await pnpm(['--config.dlx-cache-max-age=0', '--config.cache-dir=' + cache, '--config.store-dir=' + join(root, 'store'),
      'dlx', '--package=' + asset, 'latest-test'], root);
    assert.match(result.stdout, new RegExp(version.replaceAll('.', '\\.') + '\\s*$'));
  }
  assert.ok(requests >= 2);
});

function release(version) {
  return { html_url: 'https://github.com/xue-ding-e/DSH-Next-Profile/releases/tag/v' + version };
}

async function latestFixture(t) {
  const root = await fixture(t);
  const source = join(root, 'zip source 中文', 'installer');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'Install.ps1'),
    '[IO.File]::WriteAllText($env:DSH_LATEST_ARGS, (ConvertTo-Json -InputObject @($args)))\nexit ([int]$env:DSH_LATEST_EXIT)\n');
  const archive = join(root, 'fixture.zip');
  await execute(powershell(), ['-NoProfile', '-NonInteractive', '-Command',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:DSH_LATEST_SOURCE, $env:DSH_LATEST_ZIP)'],
  { env: { ...cleanEnvironment(), DSH_LATEST_SOURCE: join(root, 'zip source 中文'), DSH_LATEST_ZIP: archive } });
  const checksum = createHash('sha256').update(await readFile(archive)).digest('hex');
  const driver = join(root, 'driver.ps1');
  await writeFile(driver, '\uFEFF' + [
    "$ErrorActionPreference = 'Stop'",
    '. $env:DSH_LATEST_SCRIPT',
    'function Invoke-WebRequest {',
    '  param($Uri, $Headers, $OutFile, $TimeoutSec, $Method, [switch]$UseBasicParsing)',
    '  Add-Content -LiteralPath $env:DSH_LATEST_REQUESTS -Value $Uri',
    '  if ($Uri -match "api.github.com") { throw "The bootstrap must not consume the anonymous REST API quota." }',
    '  if ($Method -eq "Head") {',
    '    $release = Get-Content -Raw -LiteralPath $env:DSH_LATEST_METADATA | ConvertFrom-Json',
    '    if ($env:DSH_LATEST_PS7_RESPONSE) { return @{ BaseResponse = @{ RequestMessage = @{ RequestUri = [uri]$release.html_url } } } }',
    '    return @{ BaseResponse = @{ ResponseUri = [uri]$release.html_url } }',
    '  }',
    '  if ($OutFile) {',
    '    [IO.File]::WriteAllText($env:DSH_LATEST_TEMP, (Split-Path -Parent $OutFile))',
    '    Copy-Item -LiteralPath $env:DSH_LATEST_ZIP -Destination $OutFile',
    '  } else { return @{ Content = [IO.File]::ReadAllText($env:DSH_LATEST_SUMS) } }',
    '}',
    'Invoke-DshProfileLatest -HostKind original -Command doctor -AppDir "C:/Program Files/Host" -HomeDirectory "C:/data 中文" -MatchBaseline',
  ].join('\n') + '\n');
  return { root, checksum, archive, driver,
    env: { ...cleanEnvironment(), DSH_LATEST_SCRIPT: join(repository, 'installer', 'Install-Latest.ps1'),
      DSH_LATEST_SOURCE: source, DSH_LATEST_ZIP: archive, DSH_LATEST_METADATA: join(root, 'release.json'),
      DSH_LATEST_SUMS: join(root, 'SHA256SUMS'), DSH_LATEST_ARGS: join(root, 'args.json'),
      DSH_LATEST_EXIT: '0', DSH_LATEST_REQUESTS: join(root, 'requests'), DSH_LATEST_TEMP: join(root, 'temp-path') } };
}

async function run(f, env = {}) {
  return execute(powershell(), ['-NoProfile', '-NonInteractive', '-File', f.driver], { env: { ...f.env, ...env } });
}

test('latest bootstrap resolves each stable release anew, verifies its archive and forwards host options', windows, async t => {
  const f = await latestFixture(t);
  for (const version of ['1.2.3', '1.2.4']) {
    await json(f.env.DSH_LATEST_METADATA, release(version));
    await writeFile(f.env.DSH_LATEST_SUMS, f.checksum + '  dsh-next-profile-' + version + '-windows.zip\n');
    const result = await run(f, version === '1.2.4' ? { DSH_LATEST_PS7_RESPONSE: '1' } : {});
    assert.match(result.stdout, new RegExp('DSH Next Profile v' + version.replaceAll('.', '\\.')));
    assert.deepEqual(JSON.parse(await readFile(f.env.DSH_LATEST_ARGS, 'utf8')), [
      'doctor', '--host', 'original', '--app-dir', 'C:/Program Files/Host', '--home', 'C:/data 中文', '--match-baseline',
    ]);
    const temp = await readFile(f.env.DSH_LATEST_TEMP, 'utf8');
    await assert.rejects(stat(temp), { code: 'ENOENT' });
  }
  const requests = await readFile(f.env.DSH_LATEST_REQUESTS, 'utf8');
  assert.equal(requests.split('/releases/latest').length - 1, 2);
  assert.match(requests, /download\/v1\.2\.3\/dsh-next-profile-1\.2\.3-windows\.zip/u);
  assert.match(requests, /download\/v1\.2\.4\/SHA256SUMS/u);
});

test('latest bootstrap rejects missing, preview and foreign release redirects before downloading', windows, async t => {
  const f = await latestFixture(t);
  const preview = release('1.2.3-rc.1');
  const incomplete = {};
  const foreign = { html_url: 'https://example.test/releases/tag/v1.2.3' };
  for (const metadata of [preview, incomplete, foreign]) {
    await json(f.env.DSH_LATEST_METADATA, metadata);
    await assert.rejects(run(f), /stable Profile release|incomplete|does not belong/u);
  }
  await assert.rejects(readFile(f.env.DSH_LATEST_TEMP), { code: 'ENOENT' });
  await assert.rejects(readFile(f.env.DSH_LATEST_ARGS), { code: 'ENOENT' });
});

test('downloaded script bytes run as PowerShell input with the default Next install options', windows, async t => {
  const f = await latestFixture(t);
  await json(f.env.DSH_LATEST_METADATA, release('1.2.3'));
  await writeFile(f.env.DSH_LATEST_SUMS, f.checksum + '  dsh-next-profile-1.2.3-windows.zip\n');
  const driver = await readFile(f.driver, 'utf8');
  await writeFile(f.driver, driver.replace(/^Invoke-DshProfileLatest .*$/mu,
    '[Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($env:DSH_LATEST_SCRIPT)) | Invoke-Expression'));
  await run(f);
  assert.deepEqual(JSON.parse(await readFile(f.env.DSH_LATEST_ARGS, 'utf8')), ['install', '--host', 'next']);
});

test('latest bootstrap refuses a wrong checksum and propagates the installed CLI failure', windows, async t => {
  const f = await latestFixture(t);
  await json(f.env.DSH_LATEST_METADATA, release('1.2.3'));
  const name = 'dsh-next-profile-1.2.3-windows.zip';
  for (const sums of ['0'.repeat(64) + '  ' + name, f.checksum + '  another.zip',
    (f.checksum + '  ' + name + '\n').repeat(2)]) {
    await writeFile(f.env.DSH_LATEST_SUMS, sums);
    await assert.rejects(run(f), /SHA-256 verification failed/u);
    await assert.rejects(readFile(f.env.DSH_LATEST_ARGS), { code: 'ENOENT' });
  }
  await writeFile(f.env.DSH_LATEST_SUMS, f.checksum + '  ' + name + '\n');
  await assert.rejects(run(f, { DSH_LATEST_EXIT: '23' }), /Profile doctor failed \(exit 23\)/u);
});
