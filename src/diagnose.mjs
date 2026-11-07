import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readRelease } from './manifest.mjs';
import { complete, initializedProfile, inspectPlugins, optionalJson, profileAbsent } from './profile.mjs';
import { discoverApp, inspectRuntime, resolveHome, validateIsolation } from './runtime.mjs';
import { matchesBaseline } from './hosts.mjs';

/** Read package and bundle state without downloading archives, evaluating plugins or writing the profile. */
export async function diagnose(options, hooks = {}) {
  const release = await readRelease(options.manifest);
  const runtime = hooks.runtime ?? (options.appDir ? await inspectRuntime(options.appDir, options.host) : await discoverApp(options.host));
  const host = runtime.host;
  if (options.host && options.host !== host) throw new Error('Selected host does not match the installed package identity.');
  const home = await resolveHome(options.home, runtime.root, process.env, undefined, host);
  await validateIsolation(options, home, runtime);
  const absent = await profileAbsent(home);
  const profile = absent ? join(home, 'profiles', 'desktop') : await initializedProfile(home);
  const rows = absent ? release.plugins.map(plugin => ({ name: plugin.name, version: plugin.version,
    installedVersion: null, dependency: false, installed: false, enabled: false })) : await inspectPlugins(profile, release.plugins);
  const metadata = absent ? undefined : await optionalJson(join(profile, 'package.json'));
  const required = new Set(release.plugins.map(plugin => plugin.name));
  const extraBundles = (metadata?.dsh?.profile?.bundles ?? [])
    .filter(name => !required.has(name) && !name.startsWith('@deepseek-ai/'));
  const sourceFeatures = release.featureMatrix?.features.filter(feature => feature.placement === 'source-required').map(feature => feature.id) ?? [];
  return { schemaVersion: 1, host, runtimeVersion: runtime.version,
    applicationVersion: runtime.applicationVersion ?? null,
    baseline: release.manifest.baseline ?? null, baselineMatches: matchesBaseline(release.manifest.baseline, runtime),
    home, profile, initialized: !absent, codeInstalled: complete(rows), rows, extraBundles,
    sourceFeatures, hostMatchesFeatureSet: release.featureMatrix ? host === release.featureMatrix.fullFeatureHost : null,
    runtimeVerified: false, guiVerified: false,
    setup: requiredSetup(release.plugins),
  };
}

/** Machine-specific setup is separate from successful plugin installation. */
export function requiredSetup(plugins) {
  const setup = {
    'dsh-browser-control': 'Sign in to websites on this computer as needed.',
    'dsh-bsk-bridge': 'Install the BSK CLI and extension, then explicitly bind the intended browser on this computer.',
    'dsh-whale-boot': 'Supply a local intro video if this feature is wanted.',
    'dsh-qoder-connect': 'Configure a Qoder PAT on this computer.',
    'dsh-plugin-subscriptions': 'Authorize the providers you intend to use; configure OAuth applications when required.',
  };
  return plugins.filter(plugin => Object.hasOwn(setup, plugin.name)).map(plugin => ({ package: plugin.name, action: setup[plugin.name], verified: false }));
}

export const defaultManifest = fileURLToPath(new URL('../profile/manifest.json', import.meta.url));
