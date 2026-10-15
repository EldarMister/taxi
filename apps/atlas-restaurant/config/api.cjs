// Explicit release configuration prevents accidentally shipping a local or demo API.
function resolveApiUrl(value, production = false) {
  if (production && !value?.trim()) throw new Error('Set EXPO_PUBLIC_API_URL for the production build.');
  const url = new URL(value?.trim() || 'http://localhost:3000/api');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API URL must be HTTP(S), without credentials, query or fragment.');
  if (production && (url.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|\[::1\])/.test(url.hostname) || url.hostname.endsWith('example.com'))) throw new Error('Production requires the real public HTTPS Atlas API.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '') || '/api'}`;
}
module.exports = { resolveApiUrl };
