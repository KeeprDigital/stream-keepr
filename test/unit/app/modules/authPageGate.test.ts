import { describe, expect, it } from 'vitest';
import { PASSWORD_RESET_PAGE_PATH } from '~~/shared/utils/passwordResetLink';
import { LOGIN_PATH, loginPathFor, pageRequiresSession, postSignInPath, safeRedirectTarget } from '~/modules/auth/pageGate';

describe('pageRequiresSession', () => {
	it('gates an ordinary operator page', () => {
		expect(pageRequiresSession('/')).toBe(true);
	});

	it('lets the screen-output page through', () => {
		expect(pageRequiresSession('/event/12/screen/main')).toBe(false);
	});

	it('still gates the screens control surface, which differs by one letter', () => {
		expect(pageRequiresSession('/event/12/screens/3')).toBe(true);
	});

	it('does not gate the login page itself', () => {
		expect(pageRequiresSession(LOGIN_PATH)).toBe(false);
	});

	it('does not gate the password reset page, which only signed-out people reach', () => {
		// An invited account has no credential until its link is redeemed, so
		// gating this would be an invite only somebody who did not need it could
		// accept.
		expect(pageRequiresSession(PASSWORD_RESET_PAGE_PATH)).toBe(false);
	});

	it('gates a page that merely starts like the reset page', () => {
		// The exemption is the exact path. `/reset-password-policy` is not the
		// redemption form, and a prefix reading would publish every future sibling
		// without anybody deciding to.
		expect(pageRequiresSession('/reset-password-policy')).toBe(true);
		expect(pageRequiresSession('/reset-password/admin')).toBe(true);
	});
});

describe('safeRedirectTarget', () => {
	it('keeps an in-app path, query and all', () => {
		expect(safeRedirectTarget('/event/12/matches?round=3')).toBe('/event/12/matches?round=3');
	});

	it('refuses an absolute URL to another origin', () => {
		expect(safeRedirectTarget('https://evil.example/steal')).toBeNull();
	});

	it('refuses a protocol-relative URL, which is another origin without saying so', () => {
		expect(safeRedirectTarget('//evil.example/steal')).toBeNull();
	});

	it('refuses the backslash spelling of protocol-relative, which browsers accept', () => {
		expect(safeRedirectTarget('/\\evil.example/steal')).toBeNull();
	});

	it('refuses a path hiding the protocol-relative spelling behind a character browsers strip', () => {
		expect(safeRedirectTarget('/\t/evil.example/steal')).toBeNull();
		expect(safeRedirectTarget('/\n/evil.example/steal')).toBeNull();
		expect(safeRedirectTarget('/\r/evil.example/steal')).toBeNull();
	});

	it('refuses the login page, which would land back here', () => {
		expect(safeRedirectTarget('/login?redirect=%2F')).toBeNull();
	});

	it('refuses anything that is not a single string', () => {
		expect(safeRedirectTarget(['/a', '/b'])).toBeNull();
		expect(safeRedirectTarget(undefined)).toBeNull();
	});
});

describe('postSignInPath', () => {
	it('returns to the page the gate wrote into the query', () => {
		expect(postSignInPath({ redirect: '/event/12/matches' })).toBe('/event/12/matches');
	});

	it('goes home when nothing was written there', () => {
		expect(postSignInPath({})).toBe('/');
	});

	it('goes home rather than off-site', () => {
		expect(postSignInPath({ redirect: 'https://evil.example/steal' })).toBe('/');
	});
});

describe('loginPathFor', () => {
	it('carries the interrupted page as an encoded query value', () => {
		expect(loginPathFor('/event/12/matches?round=3'))
			.toBe('/login?redirect=%2Fevent%2F12%2Fmatches%3Fround%3D3');
	});

	it('omits the query for the page sign-in returns to anyway', () => {
		expect(loginPathFor('/')).toBe('/login');
	});

	it('omits the query for a page that could not be returned to safely', () => {
		expect(loginPathFor('//evil.example/steal')).toBe('/login');
	});
});
