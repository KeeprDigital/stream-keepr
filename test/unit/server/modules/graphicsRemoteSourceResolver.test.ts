import { describe, expect, it } from 'vitest';
import { isPublicRemoteAddress } from '~~/server/modules/graphics-asset-library/remote-source';
import { createDnsOverHttpsRemoteHostResolver } from '~~/server/modules/graphics-asset-library/remote-source-resolver';

function dnsJson(
	body: unknown,
	init: ResponseInit = {},
): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/dns-json' },
		...init,
	});
}

function createResolver(
	answer: (name: string, type: string) => Response | Promise<Response>,
) {
	const queries: { name: string; type: string }[] = [];
	const resolver = createDnsOverHttpsRemoteHostResolver({
		async fetch(request) {
			const url = new URL(request.url);
			const query = {
				name: url.searchParams.get('name') ?? '',
				type: url.searchParams.get('type') ?? '',
			};
			queries.push(query);
			expect(url.origin).toBe('https://cloudflare-dns.com');
			expect(request.headers.get('accept')).toBe('application/dns-json');
			return await answer(query.name, query.type);
		},
	});
	return { resolver, queries };
}

describe('resolved remote destination addresses', () => {
	it.each([
		'93.184.216.34',
		'8.8.8.8',
		'1.1.1.1',
		'2606:4700:10::ac42:93f3',
		'2001:4860:4860::8888',
		// 6to4 wrapping a public IPv4 (93.184.216.34) stays public.
		'2002:5db8:d822::',
	])('accepts the public address %s', (address) => {
		expect(isPublicRemoteAddress(address)).toBe(true);
	});

	it.each([
		['loopback', '127.0.0.1'],
		['loopback range', '127.255.255.254'],
		['this-network', '0.0.0.0'],
		['private class A', '10.255.0.1'],
		['private class B', '172.16.0.1'],
		['private class B upper', '172.31.255.254'],
		['private class C', '192.168.0.1'],
		['carrier-grade NAT', '100.64.0.1'],
		['link-local', '169.254.0.1'],
		['cloud metadata', '169.254.169.254'],
		['IETF protocol assignment', '192.0.0.8'],
		['documentation', '192.0.2.1'],
		['6to4 relay anycast', '192.88.99.1'],
		['benchmarking', '198.19.0.1'],
		['documentation range two', '198.51.100.1'],
		['documentation range three', '203.0.113.1'],
		['multicast', '224.0.0.1'],
		['reserved', '240.0.0.1'],
		['broadcast', '255.255.255.255'],
		['IPv6 unspecified', '::'],
		['IPv6 loopback', '::1'],
		['IPv6 unique local', 'fd00::1'],
		['IPv6 unique local lower bound', 'fc00::1'],
		['IPv6 link-local', 'fe80::1'],
		['IPv6 multicast', 'ff02::1'],
		['IPv6 documentation', '2001:db8::1'],
		['IPv6 discard-only', '100::1'],
		['IPv4-mapped loopback', '::ffff:127.0.0.1'],
		['IPv4-mapped private', '::ffff:10.0.0.1'],
		['IPv4-mapped metadata', '::ffff:169.254.169.254'],
		['NAT64-embedded private', '64:ff9b::192.168.1.1'],
		['6to4-embedded cloud metadata', '2002:a9fe:a9fe::'],
		['6to4-embedded loopback', '2002:7f00:0001::'],
		['6to4-embedded private', '2002:0a00:0001::'],
		['6to4-embedded link-local', '2002:a9fe:0001::'],
		['Teredo', '2001::1'],
		['Teredo with embedded client', '2001:0:4136:e378:8000:63bf:3fff:fdd2'],
		['zone-scoped link-local', 'fe80::1%eth0'],
		['unparseable', 'not-an-address'],
		['empty', ''],
	])('rejects the %s address %s', (_, address) => {
		expect(isPublicRemoteAddress(address)).toBe(false);
	});
});

describe('the DNS-over-HTTPS remote host resolver', () => {
	it('returns every A and AAAA answer for one hostname', async () => {
		const { resolver, queries } = createResolver((name, type) => dnsJson({
			Status: 0,
			Answer: type === '1'
				? [
						{ name, type: 5, data: 'cdn.example.test.cdn.net' },
						{ name, type: 1, data: '93.184.216.34' },
						{ name, type: 1, data: '93.184.216.35' },
					]
				: [{ name, type: 28, data: '2606:4700:10::ac42:93f3' }],
		}));

		await expect(resolver.resolve('cdn.example.test')).resolves.toEqual({
			outcome: 'resolved',
			addresses: ['93.184.216.34', '93.184.216.35', '2606:4700:10::ac42:93f3'],
		});
		expect(queries).toEqual([
			{ name: 'cdn.example.test', type: '1' },
			{ name: 'cdn.example.test', type: '28' },
		]);
	});

	it('reports a hostname with no address records as not found', async () => {
		const { resolver } = createResolver(() => dnsJson({ Status: 0, Answer: [] }));

		await expect(resolver.resolve('cdn.example.test')).resolves.toEqual({ outcome: 'not-found' });
	});

	it('reports NXDOMAIN as not found', async () => {
		const { resolver } = createResolver(() => dnsJson({ Status: 3 }));

		await expect(resolver.resolve('cdn.example.test')).resolves.toEqual({ outcome: 'not-found' });
	});

	it.each([
		{
			label: 'a resolver error status',
			answer: () => dnsJson({ Status: 2 }),
		},
		{
			label: 'an HTTP failure',
			answer: () => dnsJson({}, { status: 502 }),
		},
		{
			label: 'an unparseable body',
			answer: () => new Response('not json', { status: 200 }),
		},
		{
			label: 'a transport failure',
			answer: () => {
				throw new Error('network unreachable');
			},
		},
	])('fails closed as unavailable on $label', async ({ answer }) => {
		const { resolver } = createResolver(answer);

		await expect(resolver.resolve('cdn.example.test')).resolves.toEqual({ outcome: 'unavailable' });
	});

	it('never reports a partially resolved hostname as public', async () => {
		const { resolver } = createResolver((name, type) => type === '1'
			? dnsJson({ Status: 0, Answer: [{ name, type: 1, data: '93.184.216.34' }] })
			: dnsJson({ Status: 2 }));

		await expect(resolver.resolve('cdn.example.test')).resolves.toEqual({ outcome: 'unavailable' });
	});
});
