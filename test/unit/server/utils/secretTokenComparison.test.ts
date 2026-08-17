import { describe, expect, it } from 'vitest';
import { secretTokensMatch } from '~~/server/utils/secretTokenComparison';

/**
 * The shared-secret comparison two guards now depend on (#394 lifted it out of
 * `graphics-administrator.ts`, which had it privately since the Graphics
 * Administrator token existed).
 *
 * The timing property it exists for is not observable from a test — a wall-clock
 * assertion here would be a flake generator, not a proof. What is pinned is the
 * behaviour a rewrite could break while still looking constant-time: that it
 * answers the same as `===` in every case, including the ones a digest compare
 * could get wrong, since a comparison that is beautifully constant-time and
 * wrong is the worse failure.
 */
describe('comparing a presented secret against the configured one', () => {
	it('admits the same secret', async () => {
		await expect(secretTokensMatch('a-configured-token', 'a-configured-token')).resolves.toBe(true);
	});

	it('refuses a different secret of the same length', async () => {
		await expect(secretTokensMatch('a-configured-tokeN', 'a-configured-token')).resolves.toBe(false);
	});

	it('refuses a secret differing only in its last byte', async () => {
		// The case an early-returning `===` answers fastest, and the one a digest
		// compare must still answer correctly.
		await expect(secretTokensMatch('token-a', 'token-b')).resolves.toBe(false);
	});

	it('refuses a prefix of the configured secret', async () => {
		await expect(secretTokensMatch('a-configured', 'a-configured-token')).resolves.toBe(false);
	});

	it('refuses a secret the configured one is a prefix of', async () => {
		await expect(secretTokensMatch('a-configured-token-and-more', 'a-configured-token')).resolves.toBe(false);
	});

	it('refuses an empty candidate', async () => {
		await expect(secretTokensMatch('', 'a-configured-token')).resolves.toBe(false);
	});

	it('distinguishes secrets that differ only outside the ASCII range', async () => {
		// Encoding before hashing is what makes this true; hashing a string the
		// runtime had already narrowed would not.
		await expect(secretTokensMatch('tøken', 'token')).resolves.toBe(false);
		await expect(secretTokensMatch('tøken', 'tøken')).resolves.toBe(true);
	});
});
