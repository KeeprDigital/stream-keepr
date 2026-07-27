import type { H3Event } from 'h3';

async function tokenDigest(token: string) {
	return new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
	);
}

async function tokensMatch(candidate: string, expected: string) {
	const [candidateDigest, expectedDigest] = await Promise.all([
		tokenDigest(candidate),
		tokenDigest(expected),
	]);
	let difference = 0;
	for (let index = 0; index < expectedDigest.length; index++)
		difference |= candidateDigest[index]! ^ expectedDigest[index]!;
	return difference === 0;
}

export async function requireGraphicsAdministrator(event: H3Event) {
	const configuredToken = useRuntimeConfig(event).graphicsAdminToken.trim();
	if (!configuredToken) {
		throw createError({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Graphics administrator access is not configured',
		});
	}
	const suppliedToken = getRequestHeader(event, 'x-graphics-admin-token')?.trim() ?? '';
	if (!suppliedToken || !(await tokensMatch(suppliedToken, configuredToken))) {
		throw createError({
			statusCode: 403,
			statusMessage: 'Forbidden',
			message: 'Graphics administrator authorization is required',
		});
	}
}
