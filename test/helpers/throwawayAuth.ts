import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { authStaticOptions } from '~~/server/utils/authOptions';

/**
 * A real Better Auth instance configured exactly as the server configures its
 * own — `authStaticOptions`, the static half `server/utils/auth.ts` spreads —
 * over a memory adapter, so a unit test can hold the library's behaviour to
 * account without a database or a spawned server.
 *
 * This is the seam the #410 pattern runs through: the suites that pin what the
 * library does with the options this installation states (the origin check,
 * client-IP resolution) all construct one of these, and what makes their
 * assertions honest is that the options object is the server's, not a copy
 * that could drift.
 */
export function throwawayAuth() {
	return betterAuth({
		...authStaticOptions,
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		secret: 'a-throwaway-secret-for-the-unit-suite',
	});
}

export type ThrowawayAuth = ReturnType<typeof throwawayAuth>;

/**
 * The hostname the throwaway instance is addressed on. In the allowlist
 * `authStaticOptions` states (`localhost:*`), so a request naming it passes
 * the origin check unless a case is deliberately about failing one.
 */
export const LOCAL_HOST = 'localhost:3000';
export const LOCAL_ORIGIN = `http://${LOCAL_HOST}`;
