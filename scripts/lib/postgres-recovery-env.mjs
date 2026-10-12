/** Target validation belongs to the recovery CLI. Never inherit libpq controls:
 * PGHOSTADDR can redirect PGHOST; an empty PGSERVICE is still a service name. */
export function postgresRecoveryEnvironment(base, value) {
  const url = value instanceof URL ? value : new URL(value);
  const environment = Object.fromEntries(Object.entries(base).filter(([key]) => !/^PG/i.test(key)));
  return { ...environment, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: url.pathname.slice(1),
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '10' };
}
