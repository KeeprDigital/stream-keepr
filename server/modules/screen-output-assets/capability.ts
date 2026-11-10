const CAPABILITY_CONTEXT = 'stream-keepr:screen-output-assets:v1';
const REPRESENTATION_CONTEXT = 'stream-keepr:screen-output-asset-representation:v1';

function decodeSigningKey(value: string): Uint8Array<ArrayBuffer> {
	let decoded: string;
	try {
		decoded = atob(value);
	}
	catch {
		throw new Error('Screen Output capability signing key must be 32-byte base64');
	}
	const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
	for (let index = 0; index < decoded.length; index++)
		bytes[index] = decoded.charCodeAt(index);
	if (bytes.byteLength !== 32)
		throw new Error('Screen Output capability signing key must be 32-byte base64');
	return bytes;
}

export function assertScreenOutputCapabilitySigningKey(value: string): void {
	decodeSigningKey(value);
}

function base64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes)
		binary += String.fromCharCode(byte);
	return btoa(binary)
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');
}

/**
 * HMAC-SHA256 under the signing key over `context\0value`. The context separates
 * each thing derived from the one key, so none can stand in for another.
 */
export async function screenOutputSigningMac(input: {
	signingKey: string;
	context: string;
	value: string;
}): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		'raw',
		decodeSigningKey(input.signingKey),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const message = new TextEncoder().encode(
		`${input.context}\0${input.value}`,
	);
	return new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
}

async function deriveToken(input: {
	signingKey: string;
	context: string;
	value: string;
}): Promise<string> {
	return base64Url(await screenOutputSigningMac(input));
}

export async function createScreenOutputAssetCapability(input: {
	signingKey: string;
	seed: string;
	version: number;
}): Promise<string> {
	if (!input.seed || !Number.isSafeInteger(input.version) || input.version <= 0)
		throw new Error('Screen Output capability identity is invalid');
	return await deriveToken({
		signingKey: input.signingKey,
		context: CAPABILITY_CONTEXT,
		value: `${input.seed}\0${input.version}`,
	});
}

export async function screenOutputAssetRepresentationTag(input: {
	signingKey: string;
	contentIdentity: string;
}): Promise<string> {
	return await deriveToken({
		signingKey: input.signingKey,
		context: REPRESENTATION_CONTEXT,
		value: input.contentIdentity,
	});
}

export async function screenOutputAssetCapabilityDigest(capability: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(capability),
	);
	return Array.from(
		new Uint8Array(digest),
		byte => byte.toString(16).padStart(2, '0'),
	).join('');
}
