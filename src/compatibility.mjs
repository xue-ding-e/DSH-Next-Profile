/** Check that a compatibility record describes the exact plugin versions being installed. */
export function validateCompatibility(record, plugins) {
  if (record?.schemaVersion !== 1 || !Array.isArray(record.plugins)
    || plugins.some(plugin => !record.plugins.some(row => row.name === plugin.name && row.version === plugin.version))) {
    throw new Error('Compatibility record does not cover these locked plugin versions. Refresh it before release.');
  }
  return record;
}

/** Installation evidence and application readiness are reported independently. */
export function reportCompatibility(record, plugins, host, version, log) {
  if (!record) {
    log('Compatibility: no host compatibility record supplied; application startup has not been verified by this installer.');
    return;
  }
  const ref = record.hostRefs?.[host === 'original' ? 'official' : 'next'];
  log(`Compatibility reference: ${host} ${ref?.version ?? 'unspecified'}; selected host ${version}. Runtime/GUI status is reported separately from code installation.`);
  for (const plugin of plugins) {
    const row = record.plugins.find(item => item.name === plugin.name);
    log(`Compatibility (${plugin.name}): ${row.status}; runtime=${row.runtimeVerification ?? 'not-run'}`);
    for (const gap of row.confirmedGaps ?? []) log(`  ${gap.capability}: ${gap.detail}`);
  }
}

/** Report which parts of the complete DSH Next experience are supplied by the host. */
export function reportFeatureMatrix(record, host, log) {
  if (!record) {
    log('Feature coverage: no feature matrix supplied; source-owned host requirements are unknown.');
    return;
  }
  const pluginFeatures = record.features.filter(feature => feature.placement === 'plugin');
  const defaultPluginFeatures = pluginFeatures.filter(feature => feature.includedByDefault === true);
  const optionalPluginFeatures = pluginFeatures.filter(feature => feature.includedByDefault !== true);
  const sourceFeatures = record.features.filter(feature => feature.placement === 'source-required');
  const candidates = record.features.filter(feature => feature.placement === 'plugin-candidate');
  log(`Feature coverage: ${defaultPluginFeatures.length} default external plugin features, ${optionalPluginFeatures.length} optional external plugin features, ${sourceFeatures.length} host-owned features, ${candidates.length} plugin candidates.`);
  if (host !== record.fullFeatureHost && sourceFeatures.length > 0) {
    log(`Feature coverage: host=${host} receives the plugin subset only; the complete feature set requires host=${record.fullFeatureHost}.`);
  }
  for (const feature of candidates) log(`Feature candidate (${feature.id}): remains in source until its complete Host and Client implementation is extracted.`);
}
