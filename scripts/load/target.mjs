// Browser/k6-compatible: no Node or remote module dependencies.
export function assertLoadTarget(value, approvedStagingOrigin = '') {
  if (typeof value !== 'string' || !/^https?:\/\/[^/?#]+(?:\/api)?$/.test(value)) throw new Error('Load target must be one exact HTTP(S) origin, optionally ending in /api.');
  const origin = value.replace(/\/api$/, '');
  if (/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || /^http:\/\/\[::1\]:\d+$/.test(origin)) return value;
  if (origin !== approvedStagingOrigin || !/^https:\/\/[^/?#]+$/.test(approvedStagingOrigin)
    || /production|prod[.-]/i.test(origin)) throw new Error('Remote load is refused without an exact, explicitly authorized HTTPS staging origin.');
  return value;
}
export function validateLoadManifest(manifest) {
  if (!manifest.fixtureRunId || !manifest.candidate?.commit || !manifest.candidate?.sourceDigest
    || !manifest.resources?.host || !manifest.resources?.api || !manifest.resources?.postgres
    || !manifest.resources?.generator || !manifest.providers || !manifest.approvalId) throw new Error('Load manifest must freeze candidate, synthetic fixture namespace, approval, providers and environment resources.');
  for (const name of ['api', 'postgres', 'generator']) {
    const item = manifest.resources[name];
    if (!(item.cpu > 0) || !(item.memoryMiB > 0) || !(item.replicas > 0)) throw new Error(`Load resource budget missing: ${name}.`);
  }
  return manifest;
}
