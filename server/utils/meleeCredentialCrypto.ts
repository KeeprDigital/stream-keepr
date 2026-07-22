const ENVELOPE_PREFIX = 'stream-keepr:melee-credential:';
const ENVELOPE_VERSION = 1;
const AES_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BITS = 128;
const KEY_VERSION_PATTERN = /^\w[\w.-]{0,63}$/;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export interface MeleeCredentialEnvelope {
	version: typeof ENVELOPE_VERSION;
	keyVersion: string;
	iv: string;
	ciphertext: string;
}

export interface MeleeCredentialKeyring {
	activeKeyVersion: string;
	keys: ReadonlyMap<string, string>;
}

export interface DecryptedMeleeCredential {
	plaintext: string;
	legacyPlaintext: boolean;
	keyVersion: string | null;
	needsReEncryption: boolean;
}

export class MeleeCredentialCryptoError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = 'MeleeCredentialCryptoError';
		this.code = code;
	}
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes)
		binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64ToBytes(value: string, field: string): Uint8Array<ArrayBuffer> {
	try {
		const binary = atob(value);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index++)
			bytes[index] = binary.charCodeAt(index);
		return bytes;
	}
	catch {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_INVALID_BASE64',
			`Stored Melee credential ${field} is not valid base64`,
		);
	}
}

function additionalData(envelope: Pick<MeleeCredentialEnvelope, 'version' | 'keyVersion'>) {
	return textEncoder.encode(`stream-keepr:melee:${envelope.version}:${envelope.keyVersion}`);
}

function parseEnvelope(storedValue: string): MeleeCredentialEnvelope {
	let parsed: unknown;
	try {
		parsed = JSON.parse(storedValue.slice(ENVELOPE_PREFIX.length));
	}
	catch {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_MALFORMED',
			'Stored Melee credential envelope is malformed',
		);
	}

	if (!parsed || typeof parsed !== 'object') {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_MALFORMED',
			'Stored Melee credential envelope is malformed',
		);
	}

	const envelope = parsed as Partial<MeleeCredentialEnvelope>;
	if (envelope.version !== ENVELOPE_VERSION) {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_UNSUPPORTED_VERSION',
			`Stored Melee credential envelope version is unsupported`,
		);
	}
	if (typeof envelope.keyVersion !== 'string' || !KEY_VERSION_PATTERN.test(envelope.keyVersion)) {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_MALFORMED',
			'Stored Melee credential envelope has no key version',
		);
	}
	if (typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_MALFORMED',
			'Stored Melee credential envelope is malformed',
		);
	}

	const iv = base64ToBytes(envelope.iv, 'IV');
	const ciphertext = base64ToBytes(envelope.ciphertext, 'ciphertext');
	if (iv.byteLength !== AES_GCM_IV_BYTES || ciphertext.byteLength < AES_GCM_TAG_BITS / 8) {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_MALFORMED',
			'Stored Melee credential envelope is malformed',
		);
	}

	return envelope as MeleeCredentialEnvelope;
}

async function importAesKey(keyBase64: string, keyVersion: string, usage: KeyUsage) {
	const keyBytes = base64ToBytes(keyBase64.trim(), 'encryption key');
	if (keyBytes.byteLength !== AES_KEY_BYTES) {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_INVALID_KEY',
			`Melee credential encryption key version "${keyVersion}" must decode to 32 bytes`,
		);
	}

	try {
		return await crypto.subtle.importKey(
			'raw',
			keyBytes,
			{ name: 'AES-GCM' },
			false,
			[usage],
		);
	}
	catch {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_INVALID_KEY',
			`Melee credential encryption key version "${keyVersion}" could not be imported`,
		);
	}
}

export function isEncryptedMeleeCredential(value: string): boolean {
	return value.startsWith(ENVELOPE_PREFIX);
}

export async function encryptMeleeCredential(
	plaintext: string,
	keyring: MeleeCredentialKeyring,
): Promise<string> {
	const keyVersion = keyring.activeKeyVersion.trim();
	if (!keyVersion) {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_KEY_VERSION_MISSING',
			'Melee credential encryption key version is not configured',
		);
	}
	if (!KEY_VERSION_PATTERN.test(keyVersion)) {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_KEY_VERSION_INVALID',
			'Melee credential encryption key version must use 1-64 letters, numbers, dots, underscores, or hyphens',
		);
	}

	const keyBase64 = keyring.keys.get(keyVersion);
	if (!keyBase64) {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_KEY_MISSING',
			`Melee credential encryption key version "${keyVersion}" is not configured`,
		);
	}

	const envelopeMetadata = { version: ENVELOPE_VERSION, keyVersion } as const;
	const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
	const key = await importAesKey(keyBase64, keyVersion, 'encrypt');
	let encrypted: ArrayBuffer;
	try {
		encrypted = await crypto.subtle.encrypt(
			{
				name: 'AES-GCM',
				iv,
				additionalData: additionalData(envelopeMetadata),
				tagLength: AES_GCM_TAG_BITS,
			},
			key,
			textEncoder.encode(plaintext),
		);
	}
	catch {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_ENCRYPTION_FAILED',
			'Melee client secret could not be encrypted',
		);
	}

	const envelope: MeleeCredentialEnvelope = {
		...envelopeMetadata,
		iv: bytesToBase64(iv),
		ciphertext: bytesToBase64(new Uint8Array(encrypted)),
	};
	return `${ENVELOPE_PREFIX}${JSON.stringify(envelope)}`;
}

export async function decryptMeleeCredential(
	storedValue: string,
	keyring: MeleeCredentialKeyring,
	options: { allowLegacyPlaintext?: boolean } = {},
): Promise<DecryptedMeleeCredential> {
	if (!isEncryptedMeleeCredential(storedValue)) {
		if (!options.allowLegacyPlaintext) {
			throw new MeleeCredentialCryptoError(
				'MELEE_CREDENTIAL_LEGACY_PLAINTEXT',
				'Stored Melee credential uses the legacy plaintext format and must be re-saved',
			);
		}
		return {
			plaintext: storedValue,
			legacyPlaintext: true,
			keyVersion: null,
			needsReEncryption: true,
		};
	}

	const envelope = parseEnvelope(storedValue);
	const keyBase64 = keyring.keys.get(envelope.keyVersion);
	if (!keyBase64) {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_KEY_MISSING',
			`Melee credential encryption key version "${envelope.keyVersion}" is not configured`,
		);
	}

	const iv = base64ToBytes(envelope.iv, 'IV');
	const ciphertext = base64ToBytes(envelope.ciphertext, 'ciphertext');
	const key = await importAesKey(keyBase64, envelope.keyVersion, 'decrypt');
	try {
		const plaintext = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv,
				additionalData: additionalData(envelope),
				tagLength: AES_GCM_TAG_BITS,
			},
			key,
			ciphertext,
		);
		return {
			plaintext: textDecoder.decode(plaintext),
			legacyPlaintext: false,
			keyVersion: envelope.keyVersion,
			needsReEncryption: envelope.keyVersion !== keyring.activeKeyVersion,
		};
	}
	catch {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_DECRYPTION_FAILED',
			'Stored Melee credential could not be decrypted; verify the configured key and envelope integrity',
		);
	}
}
