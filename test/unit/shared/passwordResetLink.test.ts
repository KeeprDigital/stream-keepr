import { describe, expect, it } from 'vitest';
import {
	PASSWORD_RESET_PAGE_PATH,
	passwordResetLinkPath,
	passwordResetTokenFromHash,
} from '~~/shared/utils/passwordResetLink';

/**
 * The reset link's encoding (#399), both halves against each other.
 *
 * One writer on the server and one reader in the browser is the pair that stops
 * agreeing when an encoding is spelled out twice, which is why they share a
 * file and why the rows below mostly round-trip rather than assert a literal.
 */

const TOKEN = 'a-token-long-enough-to-be-one';

describe('the link an administrator hands over', () => {
	it('puts the token in the fragment, never the query', () => {
		const path = passwordResetLinkPath(TOKEN);

		// The whole reason for the fragment: it is not sent to the server as part
		// of the navigation, so the token stays out of every access log between
		// the browser and the Worker.
		expect(path).toBe(`${PASSWORD_RESET_PAGE_PATH}#token=${TOKEN}`);
		expect(new URL(path, 'https://s.example').search).toBe('');
	});

	it('round-trips a token through the fragment it writes', () => {
		expect(passwordResetTokenFromHash(new URL(passwordResetLinkPath(TOKEN), 'https://s.example').hash))
			.toBe(TOKEN);
	});

	it('reads a fragment with or without its leading hash', () => {
		expect(passwordResetTokenFromHash(`token=${TOKEN}`)).toBe(TOKEN);
		expect(passwordResetTokenFromHash(`#token=${TOKEN}`)).toBe(TOKEN);
	});
});

describe('what is not a token', () => {
	it('reads a missing fragment as no token rather than as an empty one', () => {
		expect(passwordResetTokenFromHash('')).toBeNull();
		expect(passwordResetTokenFromHash('#')).toBeNull();
		expect(passwordResetTokenFromHash('#other=value')).toBeNull();
	});

	it('reads a token offered in a query string as no token', () => {
		// The fail-safe direction, and pinned because the tempting "fix" is a query
		// fallback. Better Auth's own `/reset-password/:token` callback redirects
		// with `?token=`, so a link built through it would arrive this way — and
		// accepting it would put the token back in the request logs the fragment
		// exists to keep it out of.
		expect(passwordResetTokenFromHash('?token=a-token-long-enough-to-be-one')).toBeNull();
	});

	it('reads a truncated paste as no token', () => {
		// Answered as "no token" rather than presented and refused, so a partial
		// copy out of a chat window asks for a fresh link instead of looking like
		// a server that rejected a good one.
		expect(passwordResetTokenFromHash('#token=short')).toBeNull();
	});

	it('reads a fragment carrying something that is not a token at all as none', () => {
		expect(passwordResetTokenFromHash(`#token=${'x'.repeat(201)}`)).toBeNull();
		expect(passwordResetTokenFromHash('#token=has spaces and punctuation!!')).toBeNull();
	});
});
