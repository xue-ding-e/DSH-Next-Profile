import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { execute } from '../src/process.mjs';
import { fixture } from './fixtures.mjs';
import { resolvePnpmProxyEnvironment } from '../scripts/pack-tools.mjs';

test('package transport keeps explicit proxies and loopback requests out of system-proxy discovery', async () => {
  const read = () => { throw new Error('System proxy must not be queried'); };
  for (const key of ['HTTPS_PROXY', 'http_proxy', 'ALL_PROXY', 'npm_config_proxy', 'npm_config_https_proxy']) {
    const env = { [key]: 'http://explicit.test:8080', NO_PROXY: 'localhost' };
    assert.equal(await resolvePnpmProxyEnvironment('https://github.com/example/package.tgz', env, read), env);
  }
  for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '[::1]']) {
    const env = {};
    assert.equal(await resolvePnpmProxyEnvironment('http://' + host + '/package.tgz', env, read), env);
  }
});

test('package transport uses the system proxy only for the child and preserves bypass rules', async () => {
  const env = { NO_PROXY: 'localhost,127.0.0.1', retained: 'value' };
  const result = await resolvePnpmProxyEnvironment('https://github.com/example/package.tgz', env, async () => 'http://127.0.0.1:8080');
  assert.deepEqual(result, { ...env, HTTPS_PROXY: 'http://127.0.0.1:8080' });
  assert.equal(env.HTTPS_PROXY, undefined);
  assert.equal(await resolvePnpmProxyEnvironment('https://github.com/example/package.tgz', env, async () => undefined), env);
});

test('a command deadline preserves both output streams and waits for its descendant to stop', { timeout: 20_000 }, async t => {
  const root = await fixture(t);
  const grandchild = join(root, 'grandchild.mjs');
  const child = join(root, 'child.mjs');
  const identity = join(root, 'descendant.json');
  await writeFile(grandchild, 'import { writeFileSync } from "node:fs"; import { createServer } from "node:net";\n'
    + 'const server = createServer(); server.listen(0, "127.0.0.1", () => {\n'
    + 'writeFileSync(process.argv[2], JSON.stringify({pid: process.pid, port: server.address().port}));\n'
    + 'process.send({ready: true}); });\n');
  await writeFile(child, 'import { spawn } from "node:child_process";\n'
    + 'const child = spawn(process.execPath, [process.argv[2], process.argv[3]], {stdio: ["ignore", "inherit", "inherit", "ipc"]});\n'
    + 'child.on("message", () => { console.log("fixture ready"); console.error("fixture stalled after package resolution"); });\n'
    + 'setInterval(() => {}, 1000);\n');
  await assert.rejects(execute(process.execPath, [child, grandchild, identity], {
    timeout: 3_000, label: 'published package verification',
  }), error => {
    assert.equal(error.timedOut, true);
    assert.match(error.message, /published package verification/u);
    assert.match(error.stdout, /fixture ready/u);
    assert.match(error.stderr, /fixture stalled after package resolution/u);
    assert.match(error.message, /fixture ready/u);
    assert.match(error.message, /fixture stalled after package resolution/u);
    return true;
  });
  const { pid, port } = JSON.parse(await readFile(identity, 'utf8'));
  // A reparented POSIX zombie can retain its pid after releasing all resources.
  if (process.platform === 'win32') assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  const listener = createServer();
  t.after(() => new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve())));
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(port, '127.0.0.1', resolve); });
});

test('a completed command clears its deadline and keeps both streams', async () => {
  assert.deepEqual(await execute(process.execPath, ['-e', 'console.log("out"); console.error("err")'], { timeout: 3_000 }), {
    stdout: 'out\n', stderr: 'err\n',
  });
});
