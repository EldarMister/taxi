const DEFAULT_API_URL = 'https://api-production-3839.up.railway.app/api';

function resolveApiUrl(value, production = false) {
  const configured = typeof value === 'string' ? value.trim() : '';
  let url;
  try { url = new URL(configured || DEFAULT_API_URL); }
  catch { throw new Error('EXPO_PUBLIC_API_URL must be a valid HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('EXPO_PUBLIC_API_URL must be an HTTP(S) URL without credentials, query, or fragment.');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'example.com' || hostname.endsWith('.example.com')) {
    throw new Error('EXPO_PUBLIC_API_URL points to a placeholder. Configure the actual API server.');
  }
  if (production && (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(hostname))) {
    throw new Error('Release builds require an HTTPS API accessible from the phone.');
  }
  // React Native's built-in URL exposes read-only pathname/origin getters.
  // Construct the result without assigning browser-only URL setters.
  const pathname = url.pathname.replace(/\/+$/, '') || '/api';
  return `${url.origin}${pathname}`;
}

module.exports = { DEFAULT_API_URL, resolveApiUrl };
