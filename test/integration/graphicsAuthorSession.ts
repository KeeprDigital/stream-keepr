import { fetch } from './client';

let suiteCookie: Promise<string> | undefined;

/**
 * One graphics author session for a whole suite, minted on first use.
 *
 * Every Graphics Ingestion Operation route resolves the initiating author from
 * the session, so a helper that creates an operation and a helper that later
 * works it must present the same session or the second is a different author
 * asking about somebody else's operation. Module-level helpers have no beforeAll
 * to be handed a cookie by, so they ask for this one.
 *
 * Suites that need two authors call `createGraphicsAuthorSessionCookie` twice
 * instead: distinct sessions are exactly what makes them distinct authors.
 */
export async function suiteGraphicsAuthorSessionCookie(): Promise<string> {
	suiteCookie ??= createGraphicsAuthorSessionCookie();
	return await suiteCookie;
}

export async function createGraphicsAuthorSessionCookie(): Promise<string> {
	const response = await fetch('/', {
		headers: { accept: 'text/html' },
	});
	const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
	if (!cookie)
		throw new Error('Graphics author session cookie was not issued');
	return cookie;
}
