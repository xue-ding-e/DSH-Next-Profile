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
