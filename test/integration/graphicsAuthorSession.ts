import { fetch } from '@nuxt/test-utils/e2e';

export async function createGraphicsAuthorSessionCookie(): Promise<string> {
	const response = await fetch('/', {
		headers: { accept: 'text/html' },
	});
	const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
	if (!cookie)
		throw new Error('Graphics author session cookie was not issued');
	return cookie;
}
