import { spawn } from 'node:child_process';

/** Launch executables directly; archive paths never pass through cmd.exe. */
export function execute(command, args, { env = process.env, cwd, inherit = false, timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env, cwd, windowsHide: true, shell: false,
      stdio: inherit === 'stderr' ? ['ignore', process.stderr, process.stderr] : inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    child.stdout?.on('data', chunk => { truncated ||= stdout.length + chunk.length > 2_000_000; stdout = (stdout + chunk).slice(-2_000_000); });
    child.stderr?.on('data', chunk => { truncated ||= stderr.length + chunk.length > 2_000_000; stderr = (stderr + chunk).slice(-2_000_000); });
    const timer = timeout > 0 ? setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out: ${command}`));
    }, timeout) : undefined;
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (truncated) reject(new Error(`Command output exceeded the inspection limit: ${command}`));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Command failed (exit ${code ?? signal}): ${command}\n${stderr || stdout}`));
    });
  });
}

export function cleanEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !/^(?:NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE)$/iu.test(key)));
}
