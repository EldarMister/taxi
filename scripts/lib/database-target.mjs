// A reset is permitted only for these disposable, numeric-loopback targets.
export const TEST_DATABASE_TARGETS = Object.freeze([
  '127.0.0.1:55448/taxi_security_test',
  '127.0.0.1:5432/taxi_test',
  '127.0.0.1:55432/taxi_test',
]);

export function assertTestDatabase(urlValue, env = process.env) {
  let url;
  try { url = new URL(urlValue); } catch { throw new Error('Missing or invalid disposable database URL.'); }
  const target = `${url.hostname}:${url.port || '5432'}${url.pathname}`;
  const options = [...url.searchParams], keys = options.map(([key]) => key);
  const allowedOptions = new Set(keys).size === keys.length && options.every(([key, value]) =>
    key === 'schema' ? value === 'public' : ['connection_limit', 'pool_timeout'].includes(key) && /^([1-9]|[1-5][0-9]|60)$/.test(value));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !TEST_DATABASE_TARGETS.includes(target)
    || url.hash || !allowedOptions || env.TEST_DATABASE_RESET !== 'true'
    || !['development', 'test'].includes(env.NODE_ENV)) {
    throw new Error('Refusing database writes: requires an exact disposable loopback test target, development/test mode and TEST_DATABASE_RESET=true.');
  }
  return { host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1) };
}
