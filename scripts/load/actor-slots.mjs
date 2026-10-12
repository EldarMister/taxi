// k6 VU IDs are global across concurrent scenarios. Modulo a role's size does
// not provide distinct users; bind each VU once to a distinct role-local slot.
export function createActorSlots(capacities) {
  const roles = new Map(Object.entries(capacities).map(([role, count]) => {
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid actor capacity.');
    return [role, { count, bindings: new Map() }];
  }));
  return {
    bind(role, vu) {
      const group = roles.get(role);
      if (!group || !Number.isSafeInteger(vu) || vu < 1) throw new Error('Invalid role or VU.');
      if (group.bindings.has(vu)) return group.bindings.get(vu);
      if (group.bindings.size >= group.count) throw new Error('Declared role capacity exceeded.');
      const slot = group.bindings.size;
      group.bindings.set(vu, slot);
      return slot;
    },
    snapshot() {
      return Object.fromEntries([...roles].map(([role, group]) => [role, { expected: group.count, allocated: group.bindings.size, bindings: [...group.bindings].map(([vu, slot]) => ({ vu, slot })) }]));
    },
  };
}
