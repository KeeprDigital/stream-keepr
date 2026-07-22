import type { MeleeCredentialKeyring } from '~~/server/utils/meleeCredentialCrypto';
import {
	decryptMeleeCredential,
	encryptMeleeCredential,
	MeleeCredentialCryptoError,
} from '~~/server/utils/meleeCredentialCrypto';

interface MeleeCredentialRuntimeConfig {
	meleeCredentialEncryptionKey?: unknown;
	meleeCredentialEncryptionKeyVersion?: unknown;
	meleeCredentialEncryptionPreviousKeys?: unknown;
}

const KEY_VERSION_PATTERN = /^\w[\w.-]{0,63}$/;

function optionalConfigString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function parsePreviousKeys(value: unknown): Map<string, string> {
	const configured = optionalConfigString(value);
	if (!configured)
		return new Map();

	let parsed: unknown;
	try {
		parsed = JSON.parse(configured);
	}
	catch {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_PREVIOUS_KEYS_INVALID',
			'Melee credential previous encryption keys must be a JSON object of key versions to base64 keys',
		);
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new MeleeCredentialCryptoError(
			'MELEE_CREDENTIAL_PREVIOUS_KEYS_INVALID',
			'Melee credential previous encryption keys must be a JSON object of key versions to base64 keys',
		);
	}

	const keys = new Map<string, string>();
	for (const [version, key] of Object.entries(parsed)) {
		if (!KEY_VERSION_PATTERN.test(version) || typeof key !== 'string' || !key.trim()) {
			throw new MeleeCredentialCryptoError(
				'MELEE_CREDENTIAL_PREVIOUS_KEYS_INVALID',
				'Melee credential previous encryption keys contain an invalid entry',
			);
		}
		keys.set(version.trim(), key.trim());
	}
	return keys;
}

export function getMeleeCredentialKeyring(
	config: MeleeCredentialRuntimeConfig = useRuntimeConfig(),
): MeleeCredentialKeyring {
	const activeKeyVersion = optionalConfigString(config.meleeCredentialEncryptionKeyVersion);
	const activeKey = optionalConfigString(config.meleeCredentialEncryptionKey);
	const keys = parsePreviousKeys(config.meleeCredentialEncryptionPreviousKeys);

	if (activeKeyVersion && activeKey)
		keys.set(activeKeyVersion, activeKey);

	return { activeKeyVersion, keys };
}

/** Encrypt a newly supplied client secret before it crosses the persistence boundary. */
export async function protectMeleeClientSecret(plaintext: string): Promise<string> {
	return await encryptMeleeCredential(plaintext, getMeleeCredentialKeyring());
}

/**
 * Resolve a stored client secret immediately before constructing the Melee
 * adapter. Legacy plaintext is deliberately opt-in and is re-encrypted the
 * next time the integration configuration is saved.
 */
export async function revealMeleeClientSecret(
	storedValue: string,
	options: { allowLegacyPlaintext?: boolean } = {},
) {
	return await decryptMeleeCredential(storedValue, getMeleeCredentialKeyring(), options);
}
