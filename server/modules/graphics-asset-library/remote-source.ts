/**
 * Approved remote HTTPS ingestion.
 *
 * The fetcher performs a one-time bounded copy of a public HTTPS resource. It
 * revalidates the scheme and the resolved destination at the initial URL and
 * after every redirect, supplies no credentials, and returns the response body
 * as an unread stream so the caller can bound it into staging without ever
 * buffering a complete Graphic Asset in Worker memory.
 *
 * Platform limitation (Cloudflare Workers / workerd): no runtime API exposes
 * the IP address that `fetch` actually connects to, and `fetch` cannot be
 * pinned to a pre-resolved address. Resolution is therefore performed through
 * an injected resolver and every answer is checked before the request, which
 * leaves a DNS-rebinding window between our lookup and the runtime's own.
 * Hostname-literal, denied-suffix, scheme, credential, redirect-count and
 * byte-limit rules are enforced exactly; the resolved-address rule is enforced
 * best-effort against that window. See `docs/operations/approved-remote-graphics-copy.md`.
 */

export const GRAPHICS_REMOTE_COPY_MAXIMUM_REDIRECTS = 3;

export type GraphicsRemoteSourceRejectionCode
	= | 'remote-source-not-https'
		| 'remote-source-credentials-present'
		| 'remote-source-destination-not-public'
		| 'remote-source-redirect-limit-exceeded'
		| 'remote-source-not-retrievable'
		| 'remote-source-length-exceeded';

export interface GraphicsRemoteSourceRejection {
	code: GraphicsRemoteSourceRejectionCode;
	message: string;
}

export type GraphicsRemoteHostResolution
	= | { outcome: 'resolved'; addresses: readonly string[] }
		| { outcome: 'not-found' }
		| { outcome: 'unavailable' };

export interface GraphicsRemoteHostResolver {
	resolve: (hostname: string) => Promise<GraphicsRemoteHostResolution>;
}

export type GraphicsRemoteSourceOutcome
	= | {
		outcome: 'open';
		/**
		 * The origin's declared length, or `undefined` when it declared none or
		 * declared one that is not a usable whole byte count. It stays a hint:
		 * the caller bounds the stream by the Graphic Asset kind's maximum
		 * either way, and enforces an exact match only when a length is present.
		 */
		byteLength?: number;
		body: ReadableStream<Uint8Array>;
	}
	| { outcome: 'rejected'; rejection: GraphicsRemoteSourceRejection }
	| { outcome: 'unavailable'; message: string };

export interface GraphicsRemoteSourceFetcher {
	open: (input: {
		sourceUrl: string;
		maximumByteLength: number;
	}) => Promise<GraphicsRemoteSourceOutcome>;
}

/**
 * Hostnames that never denote a public destination. Suffix entries also match
 * the bare label so `localhost` and `db.localhost` are both denied.
 */
const DENIED_HOST_SUFFIXES = [
	'localhost',
	'local',
	'internal',
	'intranet',
	'lan',
	'home.arpa',
	'in-addr.arpa',
	'ip6.arpa',
	'metadata.google.internal',
	'metadata.goog',
	'instance-data',
];

function isDeniedHostname(hostname: string) {
	const normalized = hostname.replace(/\.$/, '').toLowerCase();
	return DENIED_HOST_SUFFIXES.some(suffix =>
		normalized === suffix || normalized.endsWith(`.${suffix}`));
}

function ipv4Octets(address: string): number[] | undefined {
	const parts = address.split('.');
	if (parts.length !== 4)
		return undefined;
	const octets = parts.map(part =>
		/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN);
	return octets.every(octet => Number.isInteger(octet) && octet <= 255)
		? octets
		: undefined;
}

function isPublicIpv4(octets: readonly number[]) {
	const [first = 0, second = 0, third = 0] = octets;
	if (first === 0 || first === 10 || first === 127)
		return false;
	if (first === 100 && second >= 64 && second <= 127)
		return false;
	if (first === 169 && second === 254)
		return false;
	if (first === 172 && second >= 16 && second <= 31)
		return false;
	if (first === 192 && second === 0 && (third === 0 || third === 2))
		return false;
	if (first === 192 && second === 88 && third === 99)
		return false;
	if (first === 192 && second === 168)
		return false;
	if (first === 198 && (second === 18 || second === 19))
		return false;
	if (first === 198 && second === 51 && third === 100)
		return false;
	if (first === 203 && second === 0 && third === 113)
		return false;
	// Multicast, reserved and limited broadcast.
	return first < 224;
}

function ipv6Groups(address: string): number[] | undefined {
	const zoneless = address.split('%')[0] ?? address;
	if (!zoneless.includes(':'))
		return undefined;
	const [head = '', tail, ...extra] = zoneless.split('::');
	if (extra.length > 0)
		return undefined;

	function expand(section: string): number[] | undefined {
		if (section.length === 0)
			return [];
		const groups: number[] = [];
		const parts = section.split(':');
		for (const [index, part] of parts.entries()) {
			const trailingIpv4 = index === parts.length - 1 ? ipv4Octets(part) : undefined;
			if (trailingIpv4) {
				groups.push(
					(trailingIpv4[0]! << 8) | trailingIpv4[1]!,
					(trailingIpv4[2]! << 8) | trailingIpv4[3]!,
				);
				continue;
			}
			if (!/^[0-9a-f]{1,4}$/i.test(part))
				return undefined;
			groups.push(Number.parseInt(part, 16));
		}
		return groups;
	}

	const headGroups = expand(head);
	const tailGroups = tail === undefined ? [] : expand(tail);
	if (!headGroups || !tailGroups)
		return undefined;
	if (tail === undefined)
		return headGroups.length === 8 ? headGroups : undefined;
	const missing = 8 - headGroups.length - tailGroups.length;
	if (missing < 1)
		return undefined;
	return [...headGroups, ...Array.from<number>({ length: missing }).fill(0), ...tailGroups];
}

function ipv4FromGroupPair(high: number, low: number) {
	return [high >> 8, high & 0xFF, low >> 8, low & 0xFF];
}

function isPublicIpv6(groups: readonly number[]) {
	const [first = 0, second = 0, third = 0, fourth = 0, fifth = 0, sixth = 0] = groups;
	// Teredo (2001::/32) tunnels over an arbitrary IPv4 relay and obfuscates its
	// client address, so it can never be verified as a public destination.
	if (first === 0x2001 && second === 0)
		return false;
	// 6to4 (2002::/16) carries its IPv4 destination in the next two groups.
	if (first === 0x2002)
		return isPublicIpv4(ipv4FromGroupPair(second, third));
	// IPv4-mapped (::ffff:0:0/96) and IPv4-compatible destinations inherit the
	// IPv4 rules; NAT64 (64:ff9b::/96) embeds its IPv4 destination the same way.
	const embedsIpv4 = (
		first === 0 && second === 0 && third === 0 && fourth === 0
		&& fifth === 0 && (sixth === 0xFFFF || sixth === 0)
	) || (first === 0x64 && second === 0xFF9B && third === 0 && fourth === 0 && fifth === 0 && sixth === 0);
	if (embedsIpv4) {
		const [, , , , , , seventh = 0, eighth = 0] = groups;
		if (seventh === 0 && eighth === 0)
			return false;
		if (seventh === 0 && eighth === 1)
			return false;
		return isPublicIpv4(ipv4FromGroupPair(seventh, eighth));
	}
	// Unspecified and loopback.
	if (groups.every(group => group === 0))
		return false;
	if (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1)
		return false;
	// Discard-only (100::/64), documentation (2001:db8::/32), ORCHIDv2 (2001:20::/28).
	if (first === 0x100 && second === 0 && third === 0 && fourth === 0)
		return false;
	if (first === 0x2001 && second === 0xDB8)
		return false;
	if (first === 0x2001 && second >= 0x20 && second <= 0x2F)
		return false;
	// Unique local (fc00::/7), link-local (fe80::/10), multicast (ff00::/8).
	if ((first & 0xFE00) === 0xFC00)
		return false;
	if ((first & 0xFFC0) === 0xFE80)
		return false;
	return (first & 0xFF00) !== 0xFF00;
}

/**
 * Whether one resolved or literal address denotes a public internet
 * destination. Anything unparseable is treated as non-public.
 */
export function isPublicRemoteAddress(address: string): boolean {
	const trimmed = address.trim().replace(/^\[|\]$/g, '');
	const octets = ipv4Octets(trimmed);
	if (octets)
		return isPublicIpv4(octets);
	const groups = ipv6Groups(trimmed);
	return groups ? isPublicIpv6(groups) : false;
}

function rejection(
	code: GraphicsRemoteSourceRejectionCode,
	message: string,
): { outcome: 'rejected'; rejection: GraphicsRemoteSourceRejection } {
	return { outcome: 'rejected', rejection: { code, message } };
}

/**
 * The only part of a remote URL that may appear in a durable report, log or
 * audit record. Query parameters and fragments are treated as secrets.
 */
export function remoteSourceOrigin(url: URL): string {
	return `${url.protocol}//${url.host}`;
}

export function createGraphicsRemoteSourceFetcher(dependencies: {
	resolver: GraphicsRemoteHostResolver;
	fetch?: (request: Request) => Promise<Response>;
}): GraphicsRemoteSourceFetcher {
	const request = dependencies.fetch ?? ((input: Request) => fetch(input));

	async function validateDestination(
		url: URL,
	): Promise<GraphicsRemoteSourceOutcome | undefined> {
		if (url.protocol !== 'https:') {
			return rejection(
				'remote-source-not-https',
				'An approved remote Graphic Asset source must use public HTTPS at every hop.',
			);
		}
		if (url.username || url.password) {
			return rejection(
				'remote-source-credentials-present',
				'An approved remote Graphic Asset source must not carry embedded credentials.',
			);
		}
		if (url.hostname.length === 0 || isDeniedHostname(url.hostname)) {
			return rejection(
				'remote-source-destination-not-public',
				`${remoteSourceOrigin(url)} does not name a public internet destination.`,
			);
		}
		const literal = url.hostname.startsWith('[')
			|| ipv4Octets(url.hostname) !== undefined
			|| url.hostname.includes(':');
		if (literal) {
			return isPublicRemoteAddress(url.hostname)
				? undefined
				: rejection(
						'remote-source-destination-not-public',
						`${remoteSourceOrigin(url)} resolves to a non-public address.`,
					);
		}
		const resolution = await dependencies.resolver.resolve(url.hostname);
		if (resolution.outcome === 'unavailable') {
			return {
				outcome: 'unavailable',
				message: `The destination for ${remoteSourceOrigin(url)} could not be resolved right now.`,
			};
		}
		if (resolution.outcome === 'not-found' || resolution.addresses.length === 0) {
			return rejection(
				'remote-source-destination-not-public',
				`${remoteSourceOrigin(url)} has no public DNS result.`,
			);
		}
		return resolution.addresses.every(address => isPublicRemoteAddress(address))
			? undefined
			: rejection(
					'remote-source-destination-not-public',
					`${remoteSourceOrigin(url)} resolves to a non-public address.`,
				);
	}

	return {
		async open(input) {
			let url: URL;
			try {
				url = new URL(input.sourceUrl);
			}
			catch {
				return rejection(
					'remote-source-not-https',
					'An approved remote Graphic Asset source must be an absolute public HTTPS URL.',
				);
			}

			const visited = new Set<string>();
			for (let hop = 0; hop <= GRAPHICS_REMOTE_COPY_MAXIMUM_REDIRECTS; hop++) {
				const invalid = await validateDestination(url);
				if (invalid)
					return invalid;

				let response: Response;
				try {
					response = await request(new Request(url, {
						method: 'GET',
						redirect: 'manual',
						// No cookies, authorization, or reusable cloud credentials are
						// supplied, and none are added when a hop redirects.
						headers: { accept: '*/*' },
					}));
				}
				catch {
					return {
						outcome: 'unavailable',
						message: `${remoteSourceOrigin(url)} could not be reached right now.`,
					};
				}

				if (response.status >= 300 && response.status < 400) {
					await response.body?.cancel().catch(() => undefined);
					const location = response.headers.get('location');
					if (!location) {
						return rejection(
							'remote-source-not-retrievable',
							`${remoteSourceOrigin(url)} answered a redirect without a destination.`,
						);
					}
					if (hop === GRAPHICS_REMOTE_COPY_MAXIMUM_REDIRECTS) {
						return rejection(
							'remote-source-redirect-limit-exceeded',
							`An approved remote Graphic Asset source may follow at most ${GRAPHICS_REMOTE_COPY_MAXIMUM_REDIRECTS} redirects.`,
						);
					}
					let next: URL;
					try {
						next = new URL(location, url);
					}
					catch {
						return rejection(
							'remote-source-not-https',
							`${remoteSourceOrigin(url)} redirected to an unusable destination.`,
						);
					}
					// Keyed on the full URL: paginated redirects legitimately revisit
					// one path with different query parameters, and the hop cap
					// already bounds any chain that never terminates.
					visited.add(url.href);
					if (visited.has(next.href)) {
						return rejection(
							'remote-source-redirect-limit-exceeded',
							'The approved remote Graphic Asset source redirects in a loop.',
						);
					}
					url = next;
					continue;
				}

				if (response.status >= 500 || response.status === 429) {
					await response.body?.cancel().catch(() => undefined);
					return {
						outcome: 'unavailable',
						message: `${remoteSourceOrigin(url)} is temporarily unavailable.`,
					};
				}
				if (!response.ok || !response.body) {
					await response.body?.cancel().catch(() => undefined);
					return rejection(
						'remote-source-not-retrievable',
						`${remoteSourceOrigin(url)} did not return retrievable content.`,
					);
				}

				// A declared length is an untrusted hint. Chunked HTTP/1.1 origins,
				// HTTP/2 origins, and runtime-decompressed responses legitimately
				// omit or misstate it, so an unusable value simply means "unknown"
				// and the transfer stays bounded by the kind's maximum instead.
				const declaredLength = response.headers.get('content-length');
				const declared = declaredLength === null ? Number.NaN : Number(declaredLength);
				const byteLength = Number.isSafeInteger(declared) && declared > 0
					? declared
					: undefined;
				if (byteLength !== undefined && byteLength > input.maximumByteLength) {
					await response.body.cancel().catch(() => undefined);
					return rejection(
						'remote-source-length-exceeded',
						`The remote source declares ${byteLength} bytes, above the ${input.maximumByteLength}-byte limit for this Graphic Asset kind.`,
					);
				}
				return { outcome: 'open', byteLength, body: response.body };
			}

			return rejection(
				'remote-source-redirect-limit-exceeded',
				`An approved remote Graphic Asset source may follow at most ${GRAPHICS_REMOTE_COPY_MAXIMUM_REDIRECTS} redirects.`,
			);
		},
	};
}
