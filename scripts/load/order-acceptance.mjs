export function assertOrderEvidence(database, counters) {
  if (!database || !Array.isArray(database.taxi) || !Array.isArray(database.food) || !Array.isArray(database.commissions)
    || !Array.isArray(database.criticalOperations) || !Array.isArray(database.declaredClientIds) || !Array.isArray(database.declaredDriverIds)
    || !Array.isArray(database.restaurantActors) || !database.actors) throw new Error('Missing unique DB/history/commission and actor-allocation evidence.');
  if (Object.keys(database.actors).sort().join(',') !== 'clients,drivers,restaurants') throw new Error('Missing declared foreground role.');
  for (const [role, group] of Object.entries(database.actors)) {
    if (!(group.expected > 0) || group.allocated !== group.expected || new Set(group.bindings.map(binding => binding.slot)).size !== group.expected
      || new Set(group.bindings.map(binding => binding.vu)).size !== group.expected) throw new Error(`Declared foreground actors were not allocated distinctly: ${role}.`);
  }
  const rows = [...database.taxi, ...database.food], ids = rows.map(row => row.id), expectedClients = new Set(database.declaredClientIds);
  if (!ids.length || new Set(ids).size !== ids.length || rows.some(row => !expectedClients.has(row.clientId))) throw new Error('Unexpected or duplicate DB order/client identity.');
  const creates = database.criticalOperations.filter(operation => operation.operation === 'create' && operation.httpStatus === 201 && operation.orderId);
  const retries = database.criticalOperations.filter(operation => operation.operation === 'retry' && operation.httpStatus === 201 && operation.orderId);
  const accepted = database.criticalOperations.filter(operation => operation.operation === 'accept' && ['ASSIGNED', 'CONFIRMED'].includes(operation.orderStatus) && [200, 201].includes(operation.httpStatus));
  const completed = database.criticalOperations.filter(operation => operation.operation === 'process' && operation.orderStatus === 'COMPLETED' && [200, 201].includes(operation.httpStatus));
  for (const [name, operations, count] of [['create', creates, counters.created], ['accept', accepted, counters.accepted], ['complete', completed, counters.completed], ['retry', retries, counters.created]]) {
    const operationIds = operations.map(operation => operation.orderId);
    if (count !== operations.length || new Set(operationIds).size !== count || count !== ids.length || ids.some(id => !operationIds.includes(id))) throw new Error(`Critical ${name} counter/identity differs from unique DB orders (repeat responses cannot count as new work).`);
  }
  for (const [name, orders, sequence] of [['taxi', database.taxi, ['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED']], ['food', database.food, ['PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']]]) {
    for (const row of orders) {
      if (row.status !== 'COMPLETED' || JSON.stringify(row.history.map(item => item.status)) !== JSON.stringify(sequence)) throw new Error(`Incomplete or duplicate critical ${name} lifecycle: ${row.id}.`);
      if (row.history[0].actorId !== row.clientId) throw new Error('Creation actor differs from DB owner.');
      if (name === 'taxi' && (!database.declaredDriverIds.includes(row.driverId) || row.history.slice(1).some(item => item.actorId !== row.driverId))) throw new Error('Taxi transition actor differs from declared assigned driver.');
      if (name === 'food' && row.history.slice(1).some(item => !database.restaurantActors.some(merchant => merchant.accountId === item.actorId && merchant.restaurantId === row.restaurantId))) throw new Error('Food transition actor differs from declared restaurant membership.');
    }
  }
  if (database.commissions.length !== database.taxi.length) throw new Error('Taxi completion commission count differs from unique DB completions.');
  for (const row of database.taxi) {
    const entries = database.commissions.filter(entry => entry.orderId === row.id);
    if (entries.length !== 1 || entries[0].driverId !== row.driverId || entries[0].idempotencyKey !== `commission:${row.id}`) throw new Error('Missing, duplicate or foreign taxi completion commission.');
  }
  return { uniqueCreated: ids.length, uniqueAccepted: accepted.length, uniqueCompleted: completed.length, taxiCompleted: database.taxi.length, foodCompleted: database.food.length, commissionEntries: database.commissions.length };
}
