import { LOAD_ROLES, validateRoleFixtures } from './roles.mjs';

// k6 copies an element on access. Keep each actor as one element, and never
// expose the complete parsed fixture to a VU. All file/hash/validation work
// happens inside a SharedArray callback, once per shared array per process.
export function validateFullFixtures(fixtures, profile, fixtureDigest) {
  const plan = validateRoleFixtures(fixtures, profile), identities = new Set();
  const counts = {};
  for (const role of ['clients', 'drivers', 'restaurants']) {
    if (!Array.isArray(fixtures[role])) throw new Error('Missing complete fixture actor array.');
    counts[role] = fixtures[role].length;
    for (const actor of fixtures[role]) {
      const id = actor?.userId || actor?.accountId;
      if (typeof id !== 'string' || !id || typeof actor.token !== 'string' || !actor.token || identities.has(id)) throw new Error('Complete fixture actor ownership is invalid.');
      identities.add(id);
    }
  }
  const metadata = { fixtureRunId: fixtures.fixtureRunId, fixtureDigest, plan, counts, pickup: fixtures.pickup, dropoff: fixtures.dropoff, tariffId: fixtures.tariffId };
  if (JSON.stringify(metadata).length > 4096) throw new Error('Fixture metadata exceeds its bounded size.');
  return metadata;
}

export function sharedRoleFixtures({ SharedArray, open, sha256, path, expectedDigest, role, profile }) {
  if (!LOAD_ROLES.includes(role) || !expectedDigest) throw new Error('Requires an immutable fixture and one declared role per k6 process.');
  function readFixture() {
    const text = open(path), digest = sha256(text);
    if (digest !== expectedDigest) throw new Error('Immutable fixture digest mismatch.');
    const fixture = JSON.parse(text), metadata = validateFullFixtures(fixture, profile, digest);
    return { fixture, metadata };
  }
  const prefix = 'isolated-load-' + expectedDigest;
  const metadata = new SharedArray(prefix + '-metadata', () => [readFixture().metadata])[0];
  const groups = {};
  for (const name of (role === 'booking' ? ['clients', 'restaurants'] : [role])) {
    groups[name] = new SharedArray(prefix + '-' + name, () => {
      const { fixture } = readFixture();
      const count = name === 'clients' ? Math.floor(profile.activeUsers * .8) : metadata.plan[name];
      return fixture[name].slice(0, count);
    });
  }
  return { metadata, groups };
}
