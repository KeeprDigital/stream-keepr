/**
 * Comparing a presented shared secret against the configured one without
 * leaking where the two diverge.
 *
 * `===` on two strings returns at the first differing byte, so the time it takes
 * is a function of how much of the secret the caller already has right. Hashing
 * both sides first fixes the compared length at 32 bytes whatever was presented,
 * and the loop below reads every one of them — the result is accumulated with
 * `|=` rather than returned early, which is the whole point.
 *
 * It lived privately inside `server/modules/graphics-administrator.ts` until
 * #394 needed the same comparison for the first-admin bootstrap token. A second
 * hand-written copy of a timing-safe compare is the kind of thing that stays
 * right in one file and quietly regrows an early return in the other, so there
 * is one.
 *
 * `crypto.subtle` rather than `node:crypto`'s `timingSafeEqual`: this runs in
 * `workerd`, where the Web Crypto API is the resident one.
 */

async function tokenDigest(token: string) {
	return new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
	);
}

/** Whether a presented secret is the configured one, in time that does not say how nearly. */
export async function secretTokensMatch(candidate: string, expected: string) {
	const [candidateDigest, expectedDigest] = await Promise.all([
		tokenDigest(candidate),
		tokenDigest(expected),
	]);
	let difference = 0;
	for (let index = 0; index < expectedDigest.length; index++)
		difference |= candidateDigest[index]! ^ expectedDigest[index]!;
	return difference === 0;
}
