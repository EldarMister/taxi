// Execute with the Playwright browser tool while browser-fixture.cjs runs.
// A fresh isolated browser context uses only the loopback synthetic fixture.
async (page) => {
  const origin = 'http://127.0.0.1:59421';
  const browser = page.context().browser();
  const context = await browser.newContext();
  const checks = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
  let restarted;
  try {
    const first = await context.newPage();
    await first.goto(origin + '/admin/#cities');
    await first.getByRole('textbox', { name: 'Логин' }).fill('fixture-admin');
    await first.getByRole('textbox', { name: 'Пароль' }).fill('fixture-password-only-42');
    await first.getByRole('button', { name: 'Войти', exact: true }).click();
    await first.getByRole('button', { name: 'Выйти' }).waitFor();
    const cookie = (await context.cookies()).find(value => value.name === 'atlas.admin');
    assert(cookie.httpOnly && cookie.sameSite === 'Strict' && cookie.path === '/api/admin/auth/browser', 'Browser respects HttpOnly, SameSite Strict and the scoped auth cookie path');
    assert(cookie.expires > 0, 'Remembered login creates an expiring persistent cookie');
    const secretsAbsent = await first.evaluate(() => !document.cookie.includes('atlas.admin=') && ![...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => /fixture-(?:access|cookie)-|refreshToken/.test(value)));
    assert(secretsAbsent, 'Auth cookie is inaccessible to JavaScript and neither token is persisted');
    await first.reload();
    await first.getByRole('button', { name: 'Выйти' }).waitFor();
    assert(true, 'Reload restores the real admin UI through the cookie');
    const second = await context.newPage(); await second.goto(origin + '/admin/#cities');
    await second.getByRole('button', { name: 'Выйти' }).waitFor();
    const beforeCookie = (await context.cookies()).find(value => value.name === 'atlas.admin').value;
    await Promise.all([first.evaluate(async () => (await import('./api.js')).refresh()), second.evaluate(async () => (await import('./api.js')).refresh())]);
    assert((await context.cookies()).find(value => value.name === 'atlas.admin').value === beforeCookie, 'Concurrent tab refresh leaves the stable browser cookie unchanged');
    const beforeOutage = await first.evaluate(async () => (await fetch('/__fixture/control')).json());
    await first.evaluate(async () => fetch('/__fixture/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outage: true }) }));
    const checked = await first.evaluate(async () => { const api = await import('./api.js'); try { await api.api('/admin/cities'); return false; } catch (error) { return error.status === 503 && !!api.session(); } });
    assert(checked, 'Database outage rejects protected HTTP data while keeping the checked memory session');
    await first.getByRole('button', { name: 'Выйти' }).click();
    await first.getByRole('button', { name: 'Повторить выход' }).waitFor();
    await second.getByRole('button', { name: 'Войти', exact: true }).waitFor();
    assert(await second.evaluate(async () => !(await import('./api.js')).session()), 'Explicit logout immediately closes the other tab without publishing a token');
    await first.reload();
    await first.getByRole('button', { name: 'Повторить выход' }).waitFor();
    const duringOutage = await first.evaluate(async () => (await fetch('/__fixture/control')).json());
    assert(duringOutage.refresh === beforeOutage.refresh, 'Reload during failed logout retries revocation and never restores the old cookie session');
    await first.evaluate(async () => fetch('/__fixture/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outage: false }) }));
    await first.getByRole('button', { name: 'Повторить выход' }).click();
    await first.getByRole('button', { name: 'Повторить выход' }).waitFor({ state: 'detached' });
    assert(!(await context.cookies()).some(value => value.name === 'atlas.admin' || value.name === 'atlas.admin.logout-pending'), 'Successful retry removes both the auth cookie and the nonsecret pending-logout cookie');
    await first.getByRole('textbox', { name: 'Логин' }).fill('fixture-admin');
    await first.getByRole('textbox', { name: 'Пароль' }).fill('fixture-password-only-42');
    await first.getByRole('checkbox', { name: 'Запомнить вход на этом устройстве' }).uncheck();
    await first.getByRole('button', { name: 'Войти', exact: true }).click();
    await first.getByRole('button', { name: 'Выйти' }).waitFor();
    assert((await context.cookies()).find(value => value.name === 'atlas.admin').expires === -1, 'Unchecked remember option creates a browser session cookie');
    await first.reload(); await first.getByRole('button', { name: 'Выйти' }).waitFor();
    assert(true, 'A nonremembered session still survives page reload within the browser session');
    const state = await context.storageState();
    restarted = await browser.newContext({ storageState: { ...state, cookies: state.cookies.filter(value => value.expires > Date.now() / 1000) } });
    const clean = await restarted.newPage(); await clean.goto(origin + '/admin/#cities');
    await clean.getByRole('button', { name: 'Войти', exact: true }).waitFor();
    assert(true, 'A simulated browser restart without session cookies requires sign-in');
    return { topology: 'website loopback proxy -> separate loopback synthetic API', checks: checks.length, results: checks, actualBackend: false, productionDomainsVerified: false, productionSecureFlagVerified: false };
  } finally { await restarted?.close(); await context.close(); }
}
