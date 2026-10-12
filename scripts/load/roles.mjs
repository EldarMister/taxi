// Shared with k6: each role runs in its own process with one scenario. VU IDs
// are consequently local to that role, rather than interleaved global IDs.
export const LOAD_ROLES = ['clients', 'drivers', 'restaurants', 'booking'];
export function rolePlan(profile) {
  const clients = Math.floor(profile.activeUsers * .8), drivers = Math.round(profile.activeUsers * .15);
  const booking = Math.max(1, Math.floor(clients * .05));
  return { clients: clients - booking, drivers, restaurants: profile.activeUsers - clients - drivers, booking };
}
export function roleSlot(role, vu, plan) {
  if (!LOAD_ROLES.includes(role) || role === 'booking' || !Number.isSafeInteger(vu) || vu < 1 || vu > plan[role]) throw new Error('Role-local VU exceeds immutable actor quota.');
  return vu - 1;
}
export function bookingActorIndex(iteration, profile) {
  const clients = Math.floor(profile.activeUsers * .8), browse = rolePlan(profile).clients;
  const budget = Math.ceil(clients * (profile.durationSeconds - 60) / 120);
  if (!Number.isSafeInteger(iteration) || iteration < 0 || budget > clients) throw new Error('Invalid unique booking iteration or budget.');
  return iteration < budget ? (browse + iteration) % clients : null;
}
export function validateRoleFixtures(fixtures, profile) {
  const plan = rolePlan(profile);
  if (fixtures.fixtureRunId !== profile.fixtureRunId) throw new Error('Load fixture identity mismatch.');
  const groups = { clients: fixtures.clients?.slice(0, Math.floor(profile.activeUsers * .8)), drivers: fixtures.drivers?.slice(0, plan.drivers), restaurants: fixtures.restaurants?.slice(0, plan.restaurants) };
  for (const [role, entries] of Object.entries(groups)) {
    const needed = role === 'clients' ? Math.floor(profile.activeUsers * .8) : plan[role];
    if (entries?.length !== needed || entries.some(a => !(a.userId || a.accountId) || !a.token) || new Set(entries.map(a => a.userId || a.accountId)).size !== needed) throw new Error('Fixture does not provide distinct owned actors for ' + role + '.');
  }
  const identities = Object.values(groups).flat().map(a => a.userId || a.accountId);
  if (new Set(identities).size !== identities.length) throw new Error('Cross-role actor ownership collision.');
  return plan;
}
export function assertRoleAllocations(records, fixtures, profile) {
  const plan = validateRoleFixtures(fixtures, profile), actors = {};
  for (const role of LOAD_ROLES.filter(name => name !== 'booking')) {
    const group = fixtures[role], entries = records.filter(x => x.kind === 'actor' && x.role === role);
    if (entries.length !== plan[role] || new Set(entries.map(x => x.vu)).size !== plan[role]) throw new Error('Incomplete distinct role actor allocation: ' + role);
    for (const entry of entries) if (roleSlot(role, entry.vu, plan) !== entry.slot || entry.actorId !== (group[entry.slot].userId || group[entry.slot].accountId)) throw new Error('Role actor identity mismatch.');
    actors[role] = { expected: plan[role], allocated: entries.length, bindings: entries.map(({ vu, slot }) => ({ vu, slot })) };
  }
  const bookings = records.filter(x => x.kind === 'booking-actor'), budget = Math.ceil(Math.floor(profile.activeUsers * .8) * (profile.durationSeconds - 60) / 120);
  if (bookings.length !== budget || new Set(bookings.map(x => x.iteration)).size !== budget || new Set(bookings.map(x => x.actorId)).size !== budget) throw new Error('Incomplete unique booking actor allocation.');
  for (const entry of bookings) if (entry.role !== 'booking' || bookingActorIndex(entry.iteration, profile) === null || fixtures.clients[bookingActorIndex(entry.iteration, profile)].userId !== entry.actorId) throw new Error('Booking actor identity mismatch.');
  return actors;
}
