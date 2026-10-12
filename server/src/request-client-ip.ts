import { BlockList, isIP } from 'node:net';

type ClientRequest = {
  socket?: {remoteAddress?: string};
  connection?: {remoteAddress?: string};
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
};

const normalize = (value: string) => value.replace(/^::ffff:(?=\d+\.)/i, '');
let cachedSpec: string | undefined;
let cachedPeers: BlockList;

/** Only network peers explicitly allowed by the operator can supply X-Real-IP.
 * Host, HTTPS and edge-marker headers are client-controlled and prove nothing.
 * Configure this only after verifying that the ingress overwrites X-Real-IP
 * and direct traffic cannot enter through a trusted peer. Empty means no proxy.
 */
export function trustedProxyPeers(spec: string): BlockList {
  const peers = new BlockList();
  for (const entry of spec.split(',').map(value => value.trim()).filter(Boolean)) {
    const [address, prefix, extra] = entry.split('/');
    const family = isIP(address);
    if (!family || extra !== undefined) throw new Error('Invalid TRUSTED_PROXY_CIDRS');
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) peers.addAddress(address, type);
    else {
      const bits = Number(prefix);
      if (!/^\d+$/.test(prefix) || !Number.isInteger(bits) || bits < 1 || bits > (family === 4 ? 32 : 128))
        throw new Error('Invalid TRUSTED_PROXY_CIDRS');
      peers.addSubnet(address, bits, type);
    }
  }
  return peers;
}

export function requestClientIp(request: ClientRequest, spec = process.env.TRUSTED_PROXY_CIDRS ?? ''): string {
  if (cachedSpec !== spec) {
    cachedPeers = trustedProxyPeers(spec);
    cachedSpec = spec;
  }
  const rawPeer = request.socket?.remoteAddress ?? request.connection?.remoteAddress;
  // Do not fall back to Express ip: its meaning depends on trust-proxy settings.
  const peer = typeof rawPeer === 'string' ? normalize(rawPeer) : '';
  const family = isIP(peer);
  if (!family) return 'unknown';
  if (cachedPeers.check(peer, family === 4 ? 'ipv4' : 'ipv6')) {
    const header = request.headers?.['x-real-ip'];
    if (typeof header === 'string') {
      const client = normalize(header.trim());
      if (isIP(client)) return client;
    }
  }
  return peer;
}
