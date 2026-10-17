import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Defensa contra SSRF del escáner: ninguna consulta propia puede llegar a localhost,
 * redes privadas, link-local ni rangos reservados. Se valida cada IP resuelta y cada salto.
 */

const blockedV4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, metadatos de nube
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservado y broadcast
] as const) {
  blockedV4.addSubnet(network, prefix, 'ipv4');
}

// IPv6: solo unicast global (2000::/3), menos documentación, Teredo y 6to4 (encapsulan IPv4 arbitrarias).
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const blockedV6 = new BlockList();
blockedV6.addSubnet('2001::', 32, 'ipv6');
blockedV6.addSubnet('2001:db8::', 32, 'ipv6');
blockedV6.addSubnet('2002::', 16, 'ipv6');

/** true si la IP no es pública. Lo que no se puede interpretar se bloquea. */
export function isBlockedAddress(raw: string): boolean {
  const address = raw.replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  const family = isIP(address);
  if (family === 4) return blockedV4.check(address, 'ipv4');
  if (family === 6) return !globalV6.check(address, 'ipv6') || blockedV6.check(address, 'ipv6');
  return true;
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const systemResolver: HostResolver = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

export class BlockedHostError extends Error {
  constructor(readonly reason: 'private_address' | 'internal_host' | 'port' | 'scheme' | 'credentials') {
    super(`Destino bloqueado: ${reason}`);
    this.name = 'BlockedHostError';
  }
}

/**
 * Resuelve el host y exige que TODAS las IPs sean públicas (una respuesta mixta se bloquea).
 * Devuelve la primera, que es la que se usa para conectar: así no hay una segunda resolución
 * que un DNS malicioso pueda cambiar (rebinding).
 */
export async function resolvePublic(hostname: string, resolver: HostResolver): Promise<ResolvedAddress> {
  const bare = hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(bare);
  if (literal) {
    if (isBlockedAddress(bare)) throw new BlockedHostError('private_address');
    return { address: bare, family: literal === 6 ? 6 : 4 };
  }
  const addresses = await resolver(bare);
  if (addresses.length === 0) throw new Error('Sin direcciones');
  if (addresses.some((a) => isBlockedAddress(a.address))) throw new BlockedHostError('private_address');
  return addresses[0]!;
}
