import type { GraphicsRemoteHostResolver } from './remote-source';

/**
 * DNS resolution for approved remote Graphic Asset copying.
 *
 * Cloudflare's DNS-over-HTTPS JSON API is used rather than `node:dns` because it
 * behaves identically in workerd, `wrangler dev`, and Node integration runs, and
 * because its request and response contract is documented rather than dependent
 * on `nodejs_compat` polyfill coverage. Workers resolve `node:dns` through the
 * same 1.1.1.1 service, so this adds no additional trust.
 *
 * https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/
 */
const DNS_OVER_HTTPS_ENDPOINT = 'https://cloudflare-dns.com/dns-query';
const DNS_RECORD_TYPE_A = 1;
const DNS_RECORD_TYPE_AAAA = 28;
const DNS_STATUS_NO_ERROR = 0;
const DNS_STATUS_NAME_ERROR = 3;

interface DnsJsonResponse {
	Status?: number;
	Answer?: { type?: number; data?: string }[];
}

type DnsLookup
	= | { outcome: 'answered'; addresses: string[] }
		| { outcome: 'not-found' }
		| { outcome: 'unavailable' };

export function createDnsOverHttpsRemoteHostResolver(
	dependencies: { fetch?: (request: Request) => Promise<Response> } = {},
): GraphicsRemoteHostResolver {
	const request = dependencies.fetch ?? ((input: Request) => fetch(input));

	async function lookup(hostname: string, type: number): Promise<DnsLookup> {
		const query = new URL(DNS_OVER_HTTPS_ENDPOINT);
		query.searchParams.set('name', hostname);
		query.searchParams.set('type', String(type));
		let response: Response;
		try {
			response = await request(new Request(query, {
				method: 'GET',
				headers: { accept: 'application/dns-json' },
			}));
		}
		catch {
			return { outcome: 'unavailable' };
		}
		if (!response.ok)
			return { outcome: 'unavailable' };
		let answer: DnsJsonResponse;
		try {
			answer = await response.json() as DnsJsonResponse;
		}
		catch {
			return { outcome: 'unavailable' };
		}
		if (answer.Status === DNS_STATUS_NAME_ERROR)
			return { outcome: 'not-found' };
		if (answer.Status !== DNS_STATUS_NO_ERROR)
			return { outcome: 'unavailable' };
		return {
			outcome: 'answered',
			addresses: (answer.Answer ?? [])
				.filter(record => record.type === type && typeof record.data === 'string')
				.map(record => record.data!),
		};
	}

	return {
		async resolve(hostname) {
			const [ipv4, ipv6] = await Promise.all([
				lookup(hostname, DNS_RECORD_TYPE_A),
				lookup(hostname, DNS_RECORD_TYPE_AAAA),
			]);
			// An unavailable resolver must never be mistaken for a public answer,
			// and must never let a half-known destination through.
			if (ipv4.outcome === 'unavailable' || ipv6.outcome === 'unavailable')
				return { outcome: 'unavailable' };
			const addresses = [
				...ipv4.outcome === 'answered' ? ipv4.addresses : [],
				...ipv6.outcome === 'answered' ? ipv6.addresses : [],
			];
			return addresses.length > 0
				? { outcome: 'resolved', addresses }
				: { outcome: 'not-found' };
		},
	};
}
