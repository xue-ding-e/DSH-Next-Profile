/** Product identity selects the runtime entry and data root; directory names alone never do. */
export const HOSTS = Object.freeze({
  original: { product: 'DeepSeek Harness', executable: 'DeepSeek Harness.exe',
    packageName: '@deepseek-ai/dsh-desktop', home: '.dsh',
    cli: ['dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'] },
  next: { product: 'DSH Next', executable: 'DSH Next.exe', packageName: 'dsh-next-desktop',
    home: '.dsh-next', cli: ['lib', 'next-cli-entry.js'] },
});

export function hostIdentity(host) {
  if (!Object.hasOwn(HOSTS, host)) throw new Error('--host must be original or next.');
  return HOSTS[host];
}

export const capabilityNotices = [
  { plugin: 'dsh-nav-buttons', message: 'Native AppCommand support requires globalThis.dshDesktop.protocolVersion === 1 and dshDesktop.navigation.subscribe. An upstream host without that IPC only has the plugin DOM pointer fallback; installation does not verify native navigation.' },
  { plugin: 'dsh-browser-control', message: 'Requires an Electron sidebar webview with executeJavaScript/loadURL. Six tools are registered; screenshots have no supported public preload API and are not offered.' },
];
