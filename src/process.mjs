import { spawn } from 'node:child_process';
import { join } from 'node:path';

/** Stop only the process family allocated to one command, including inherited output pipes. */
async function terminateCommand(child) {
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    return;
  }
  await new Promise((resolve, reject) => {
    const killer = spawn(join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' });
    killer.once('error', reject);
    killer.once('close', code => {
      if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolve();
      else reject(new Error(`Could not terminate command process family ${child.pid} (taskkill exit ${code}).`));
    });
  });
}

/** Launch directly; deadlines terminate owned descendants and reject after output pipes close, retaining bounded diagnostics. */
export function execute(command, args, { env = process.env, cwd, inherit = false, timeout = 30_000, label = command } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env, cwd, windowsHide: true, shell: false,
      detached: process.platform !== 'win32',
      stdio: inherit === 'stderr' ? ['ignore', process.stderr, process.stderr] : inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let stopping;
    child.stdout?.on('data', chunk => { truncated ||= stdout.length + chunk.length > 2_000_000; stdout = (stdout + chunk).slice(-2_000_000); });
    child.stderr?.on('data', chunk => { truncated ||= stderr.length + chunk.length > 2_000_000; stderr = (stderr + chunk).slice(-2_000_000); });
    const timer = timeout > 0 ? setTimeout(() => {
      timedOut = true;
      stopping = terminateCommand(child).catch(error => { child.kill(); return error; });
    }, timeout) : undefined;
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', async (code, signal) => {
      clearTimeout(timer);
      const stopError = await stopping;
      const diagnostics = [stderr, stdout].filter(Boolean).join('\n');
      if (timedOut || stopError) reject(Object.assign(new Error(
        `Command timed out after ${timeout} ms: ${label}${stopError ? `; termination failed: ${stopError.message}` : ''}\n${diagnostics}`,
        stopError ? { cause: stopError } : undefined), { timedOut, stdout, stderr, exitCode: code, signal }));
      else if (truncated) reject(new Error(`Command output exceeded the inspection limit: ${label}`));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Command failed (exit ${code ?? signal}): ${label}\n${diagnostics}`));
    });
  });
}

export function cleanEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !/^(?:NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE)$/iu.test(key)));
}
