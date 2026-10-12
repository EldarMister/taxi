export function completeOrderEvidence() {
  const history = (statuses, owner, actor) => statuses.map((status, index) => ({ status, actorId: index ? actor : owner }));
  const taxi = { id: 'taxi', clientId: 'customer1', driverId: 'driver', status: 'COMPLETED', history: history(['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'], 'customer1', 'driver') };
  const food = { id: 'food', clientId: 'customer2', restaurantId: 'restaurant', status: 'COMPLETED', history: history(['PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'], 'customer2', 'merchant') };
  return { taxi: [taxi], food: [food], commissions: [{ orderId: 'taxi', driverId: 'driver', idempotencyKey: 'commission:taxi' }], declaredClientIds: ['customer1', 'customer2'], declaredDriverIds: ['driver'], restaurantActors: [{ accountId: 'merchant', restaurantId: 'restaurant' }],
    actors: Object.fromEntries(['clients', 'drivers', 'restaurants'].map(role => [role, { expected: 1, allocated: 1, bindings: [{ vu: 1, slot: 0 }] }])),
    criticalOperations: [taxi, food].flatMap(row => [{ operation: 'create', httpStatus: 201, orderId: row.id }, { operation: 'retry', httpStatus: 201, orderId: row.id }, { operation: 'accept', httpStatus: row === taxi ? 201 : 200, orderId: row.id, orderStatus: row === taxi ? 'ASSIGNED' : 'CONFIRMED' }, { operation: 'process', httpStatus: row === taxi ? 201 : 200, orderId: row.id, orderStatus: 'COMPLETED' }]) };
}
