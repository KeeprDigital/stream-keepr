import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex, sha256HexWithoutWebCrypto } from '~~/shared/utils/sha256';

function bytesOf(length: number): Uint8Array {
	return Uint8Array.from({ length }, (_, index) => (index * 31 + 7) % 256);
}

function nodeDigest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

// A page opened over plain HTTP on a LAN address has no `crypto.subtle` (README § Local auth bypass).
describe('a SHA-256 digest on a page with no Web Crypto', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each([
		{ message: 'nothing', text: '', digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
		{ message: '"abc"', text: 'abc', digest: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
	])('is the published digest of $message', ({ text, digest }) => {
		expect(sha256HexWithoutWebCrypto(new TextEncoder().encode(text))).toBe(digest);
	});

	// 55, 56, 63, 64 and 65 bytes sit either side of where padding takes a second block.
	it.each([
		1,
		55,
		56,
		63,
		64,
		65,
		119,
		120,
		1_000,
		1_000_003,
	])('agrees with the platform over %i bytes', (length) => {
		const bytes = bytesOf(length);

		expect(sha256HexWithoutWebCrypto(bytes)).toBe(nodeDigest(bytes));
	});

	it.each([
		{ page: 'has Web Crypto', crypto: undefined },
		{ page: 'has a crypto with no subtle, as a plain-HTTP LAN page does', crypto: {} },
	])('answers the same digest when the page $page', async ({ crypto }) => {
		if (crypto)
			vi.stubGlobal('crypto', crypto);
		const bytes = bytesOf(4_096);

		await expect(sha256Hex(bytes)).resolves.toBe(nodeDigest(bytes));
		await expect(sha256Hex(bytes.buffer as ArrayBuffer)).resolves.toBe(nodeDigest(bytes));
	});

	it('digests only the bytes a view covers', async () => {
		const window = bytesOf(100).subarray(10, 40);
		vi.stubGlobal('crypto', {});

		await expect(sha256Hex(window)).resolves.toBe(nodeDigest(window));
	});
});
