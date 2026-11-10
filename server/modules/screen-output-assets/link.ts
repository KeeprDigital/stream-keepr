import { secretTokensMatch } from '~~/server/utils/secretTokenComparison';
import { screenOutputSigningMac } from './capability';

/**
 * Distinct from the capability's context, so a Screen Output Link is neither
 * derivable from a Screen Output Asset Capability nor mistakable for one.
 */
const LINK_CONTEXT = 'stream-keepr:screen-output-link:v1';

/**
 * Base58 as Bitcoin orders it: no `0`, `O`, `I` or `l`, and nothing a URL
 * escapes, so a link survives being read aloud and retyped into a path.
 */
export const SCREEN_OUTPUT_LINK_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const BASE = 58n;
const MAC_BYTES = 10;
const MAC_BITS = BigInt(MAC_BYTES * 8);

/**
 * 14 characters is Screen 1; 23 is the largest id a number holds. A leading
 * `1` is base58's zero digit, a second spelling of the same number, so the
 * first character excludes it and every link has exactly one textual form.
 */
const LINK_PATTERN = /^[2-9A-HJ-NP-Za-km-z][1-9A-HJ-NP-Za-km-z]{13,22}$/;

function encode(value: bigint): string {
	let text = '';
	for (let rest = value; rest > 0n; rest /= BASE)
		text = SCREEN_OUTPUT_LINK_ALPHABET[Number(rest % BASE)]! + text;
	return text;
}

function decode(text: string): bigint {
	let value = 0n;
	for (const character of text)
		value = value * BASE + BigInt(SCREEN_OUTPUT_LINK_ALPHABET.indexOf(character));
	return value;
}

/**
 * The Screen Output Link of one Screen: base58 of the number `screenId · 2^80 +
 * MAC`, where the MAC is the first 80 bits of HMAC-SHA256 over the Screen's
 * capability seed and version.
 *
 * The id needs no length prefix, because the MAC is a fixed 80 bits: everything
 * above them is the id. Derived from what the capability is derived from, so
 * regenerating the capability regenerates the link and the old one stops
 * verifying.
 */
export async function createScreenOutputLink(input: {
	signingKey: string;
	screenId: number;
	seed: string;
	version: number;
}): Promise<string> {
	if (
		!Number.isSafeInteger(input.screenId)
		|| input.screenId <= 0
		|| !input.seed
		|| !Number.isSafeInteger(input.version)
		|| input.version <= 0
	) {
		throw new Error('Screen Output Link identity is invalid');
	}
	const mac = await screenOutputSigningMac({
		signingKey: input.signingKey,
		context: LINK_CONTEXT,
		value: `${input.seed}\0${input.version}`,
	});
	let value = BigInt(input.screenId);
	for (const byte of mac.subarray(0, MAC_BYTES))
		value = (value << 8n) | BigInt(byte);
	return encode(value);
}

/**
 * Which Screen a presented value names, or `null` where it is not a link's one
 * textual form. Says nothing about whether the link is that Screen's.
 */
export function parseScreenOutputLink(link: unknown): { screenId: number } | null {
	if (typeof link !== 'string' || !LINK_PATTERN.test(link))
		return null;
	const screenId = decode(link) >> MAC_BITS;
	if (screenId < 1n || screenId > BigInt(Number.MAX_SAFE_INTEGER))
		return null;
	return {
		screenId: Number(screenId),
	};
}

/** Stands in for the seed of a Screen that does not exist; never stored. */
export const ABSENT_SCREEN_SEED = 'absent-screen';

/**
 * Whether a presented link is the one this Screen's seed and version derive.
 *
 * A Screen that does not exist is answered after the same derivation and the
 * same constant-time comparison as one that does, so the time taken does not
 * say which of "no such Screen" and "wrong MAC" happened.
 */
export async function screenOutputLinkIsFor(input: {
	signingKey: string;
	link: string;
	screenId: number;
	identity: { seed: string; version: number } | undefined;
}): Promise<boolean> {
	const expected = await createScreenOutputLink({
		signingKey: input.signingKey,
		screenId: input.screenId,
		seed: input.identity?.seed ?? ABSENT_SCREEN_SEED,
		version: input.identity?.version ?? 1,
	});
	const matches = await secretTokensMatch(input.link, expected);
	return matches && input.identity !== undefined;
}
