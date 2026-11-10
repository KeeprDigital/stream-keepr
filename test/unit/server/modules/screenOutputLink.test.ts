import { describe, expect, it } from 'vitest';
import { createScreenOutputAssetCapability } from '~~/server/modules/screen-output-assets/capability';
import {
	ABSENT_SCREEN_SEED,
	createScreenOutputLink,
	parseScreenOutputLink,
	SCREEN_OUTPUT_LINK_ALPHABET,
	screenOutputLinkIsFor,
} from '~~/server/modules/screen-output-assets/link';

const signingKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const otherSigningKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
const MAC_BITS = 80n;
const LARGEST_MAC = (1n << MAC_BITS) - 1n;

/** The link's text form, written independently of the module: base58 of id·2^80 + MAC. */
function linkText(screenId: bigint, mac: bigint): string {
	let value = (screenId << MAC_BITS) | mac;
	let text = '';
	while (value > 0n) {
		text = SCREEN_OUTPUT_LINK_ALPHABET[Number(value % 58n)]! + text;
		value /= 58n;
	}
	return text;
}

function link(screenId: number, overrides: { seed?: string; version?: number; signingKey?: string } = {}) {
	return createScreenOutputLink({
		signingKey: overrides.signingKey ?? signingKey,
		screenId,
		seed: overrides.seed ?? 'seed-1',
		version: overrides.version ?? 1,
	});
}

function lastCharacterChanged(text: string): string {
	return `${text.slice(0, -1)}${text.endsWith('2')
		? '3'
		: '2'}`;
}

describe('a Screen Output Link\'s form', () => {
	it('uses an alphabet of 58 characters with no look-alikes and nothing a URL escapes', () => {
		expect(SCREEN_OUTPUT_LINK_ALPHABET).toMatch(/^[1-9A-HJ-NP-Za-km-z]{58}$/);
		expect(new Set(SCREEN_OUTPUT_LINK_ALPHABET).size).toBe(58);
	});

	it.each([
		[1, 14, 14],
		[3, 14, 14],
		[5, 15, 15],
		[232, 15, 15],
		[233, 15, 16],
		[234, 16, 16],
		[13_000, 16, 16],
		[14_000, 17, 17],
		[Number.MAX_SAFE_INTEGER, 23, 23],
	])('names Screen %i in %i to %i characters of that alphabet', async (screenId, shortest, longest) => {
		const text = await link(screenId);

		expect(text).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
		expect(text.length).toBeGreaterThanOrEqual(shortest);
		expect(text.length).toBeLessThanOrEqual(longest);
		expect(parseScreenOutputLink(text)).toEqual({ screenId });
	});

	it.each([
		[
			'the seed',
			{ seed: 'seed-2' },
		],
		[
			'the version',
			{ version: 2 },
		],
		[
			'the signing key',
			{ signingKey: otherSigningKey },
		],
	])('changes with %s', async (_what, changed) => {
		expect(await link(17, changed)).not.toBe(await link(17));
	});

	it.each([
		[
			'a Screen id of zero',
			{ screenId: 0 },
		],
		[
			'a negative Screen id',
			{ screenId: -1 },
		],
		[
			'a fractional Screen id',
			{ screenId: 1.5 },
		],
		[
			'a Screen id past the safe integers',
			{ screenId: Number.MAX_SAFE_INTEGER + 1 },
		],
		[
			'an empty seed',
			{ seed: '' },
		],
		[
			'a version of zero',
			{ version: 0 },
		],
	])('is not derived for %s', async (_what, invalid) => {
		await expect(createScreenOutputLink({
			signingKey,
			screenId: 17,
			seed: 'seed-1',
			version: 1,
			...invalid,
		})).rejects.toThrow('Screen Output Link identity is invalid');
	});
});

describe('which text is a Screen Output Link', () => {
	// Both sides of each bound: the id range, the alphabet, and the one textual form.
	it.each([
		[
			'the smallest link there is',
			linkText(1n, 0n),
			1,
		],
		[
			'the largest MAC under the smallest id',
			linkText(1n, LARGEST_MAC),
			1,
		],
		[
			'the largest id',
			linkText(BigInt(Number.MAX_SAFE_INTEGER), LARGEST_MAC),
			Number.MAX_SAFE_INTEGER,
		],
	])('reads %s', (_what, text, screenId) => {
		expect(parseScreenOutputLink(text)).toEqual({ screenId });
	});

	it.each([
		[
			'an id of zero',
			linkText(0n, LARGEST_MAC),
		],
		[
			'an id one past the largest',
			linkText(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 0n),
		],
		[
			'an id far past the largest',
			linkText(1n << 80n, 0n),
		],
		['a leading zero digit, a second spelling of the same number', `1${linkText(17n, 5n)}`],
		['a trailing space', `${linkText(17n, 5n)} `],
		['a trailing newline', `${linkText(17n, 5n)}\n`],
		['a leading space', ` ${linkText(17n, 5n)}`],
		['a zero, which the alphabet leaves out', `${linkText(17n, 5n).slice(0, -1)}0`],
		['a capital O', `${linkText(17n, 5n).slice(0, -1)}O`],
		['a capital I', `${linkText(17n, 5n).slice(0, -1)}I`],
		['a lower-case l', `${linkText(17n, 5n).slice(0, -1)}l`],
		['a hyphen', `${linkText(17n, 5n).slice(0, -1)}-`],
		['an underscore', `${linkText(17n, 5n).slice(0, -1)}_`],
		['a percent-encoded character', `${linkText(17n, 5n).slice(0, -3)}%41`],
		['nothing', ''],
		['a number', 17],
		['no value', undefined],
		[
			'an object',
			{
				link: linkText(17n, 5n),
			},
		],
	])('does not read %s', (_what, text) => {
		expect(parseScreenOutputLink(text)).toBeNull();
	});
});

describe('whether a Screen Output Link is a Screen\'s', () => {
	const identity = { seed: 'seed-1', version: 1 };

	it('is, for the link derived from that Screen\'s seed and version', async () => {
		expect(await screenOutputLinkIsFor({
			signingKey,
			link: await link(17),
			screenId: 17,
			identity,
		})).toBe(true);
	});

	it.each([
		[
			'from before a rotation',
			() => link(17, { seed: 'seed-0' }),
		],
		[
			'of an earlier version',
			() => link(17, { version: 2 }),
		],
		[
			'signed with another key',
			() => link(17, { signingKey: otherSigningKey }),
		],
		[
			'of another Screen holding the same seed',
			() => link(18),
		],
		[
			'with its last character changed',
			async () => lastCharacterChanged(await link(17)),
		],
	])('is not, for a link %s', async (_what, presented) => {
		expect(await screenOutputLinkIsFor({
			signingKey,
			link: await presented(),
			screenId: 17,
			identity,
		})).toBe(false);
	});

	// No Screen answers as a wrong MAC does, after the same derivation; even the
	// link that derivation produces is not a link to anything.
	it.each([
		[
			'a link some Screen once had',
			() => link(17),
		],
		[
			'the link the stand-in derivation produces',
			() => link(17, { seed: ABSENT_SCREEN_SEED }),
		],
	])('is not, for a Screen that does not exist, presented with %s', async (_what, presented) => {
		expect(await screenOutputLinkIsFor({
			signingKey,
			link: await presented(),
			screenId: 17,
			identity: undefined,
		})).toBe(false);
	});
});

describe('a Screen Output Link beside its Screen Output Asset Capability', () => {
	// Separate derivations: neither can stand in for, or be cut from, the other.
	it('shares no prefix with the capability of the same seed and version, and is not read as one', async () => {
		const capability = await createScreenOutputAssetCapability({ signingKey, seed: 'seed-1', version: 1 });
		const text = await link(17);

		expect(capability.startsWith(text)).toBe(false);
		expect(text.startsWith(capability)).toBe(false);
		expect(parseScreenOutputLink(capability)).toBeNull();
		expect(parseScreenOutputLink(capability.slice(0, text.length))).not.toEqual({ screenId: 17 });
	});
});
