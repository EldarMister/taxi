import type { Express } from 'express';

/** Keep existing public links usable, without hosting website files in the API. */
export function mountSiteRedirects(app: Express, configuredUrl = process.env.PUBLIC_SITE_URL) {
  if (!configuredUrl?.trim()) return;
  const site = new URL(configuredUrl.trim());
  if (!['https:', 'http:'].includes(site.protocol) || site.username || site.password || site.pathname !== '/' || site.search || site.hash) {
    throw new Error('PUBLIC_SITE_URL must be a public website origin');
  }
  app.use((request, response, next) => {
    if (!['GET', 'HEAD'].includes(request.method)) return next();
    const path = request.path;
    if (path !== '/' && !/^\/(admin|privacy|terms|drivers|downloads|assets)(\/|$)/.test(path)) return next();
    if (request.get('host') === site.host) return next();
    response.setHeader('Cache-Control', 'no-store');
    response.redirect(307, new URL(request.originalUrl, site.origin).toString());
  });
}
