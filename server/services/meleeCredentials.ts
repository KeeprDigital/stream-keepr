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

const PREVIOUS_KEYS_INVALID = 'Melee credential previous encryption keys must be a JSON object of key versions to base64 keys';

/**
 * A configured value as the operator wrote it, whatever runtimeConfig made of it.
 *
 * **A number is a value, not an absence**, which is the whole of this function.
 * Nuxt applies environment overrides through `destr`, so `NUXT_MELEE_CREDENTIAL_
 * ENCRYPTION_KEY_VERSION=1` — the assignment `.env.example` ships — arrives here
 * as the number 1. Reading only strings made that read as unset, and the surface
 * answered 503 naming the setting the operator had just set: the worst shape a
 * refusal can take, because the one thing it tells you to do is the thing you did.
 * Measured on a previewed Worker (#412): `=1` answered 503, `=v1` answered 200,
 * nothing else changed. A deployed installation is in the same position — a Worker
 * secret reaches runtimeConfig through the same coercion — so this is not a local
 * convenience.
 *
 * Numbers only, and finite ones. A boolean or an object is not a value anybody
 * meant to write into one of these names, and coercing it would turn a mistyped
 * setting into a key version that looks configured; those stay absent here and are
 * refused by name where they matter.
 */
function optionalConfigString(value: unknown): string {
	if (typeof value === 'string')
		return value.trim();

	return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/**
 * The retired keyring as an object, from whichever shape the environment delivered.
 *
 * The same `destr` coercion as above, and worse where it lands: `.env.example`
 * documents `NUXT_MELEE_CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS={"1":"OLD_BASE64_KEY"}`,
 * and that arrives already parsed. Read as a string and only as a string, an
 * operator mid-rotation had every retired key silently dropped — and the failure
 * surfaces on decrypting a credential stored *before* the rotation, a long way from
 * the setting that caused it.
 *
 * A number or a boolean throws rather than reading as absence, because absence is a
 * claim: it says this installation has no retired keys and every stored envelope is
 * readable with the active one. A mistyped keyring making that claim is how a
 * rotation loses data quietly.
 */
function previousKeysSource(value: unknown): unknown {
	if (value === undefined || value === null)
		return null;

	if (typeof value === 'object')
		return value;

	if (typeof value === 'string') {
		const configured = value.trim();
		if (!configured)
			return null;

		try {
			return JSON.parse(configured);
		}
		catch {
			throw new MeleeCredentialCryptoError('MELEE_CREDENTIAL_PREVIOUS_KEYS_INVALID', PREVIOUS_KEYS_INVALID);
		}
	}

	throw new MeleeCredentialCryptoError('MELEE_CREDENTIAL_PREVIOUS_KEYS_INVALID', PREVIOUS_KEYS_INVALID);
}

function parsePreviousKeys(value: unknown): Map<string, string> {
	const parsed = previousKeysSource(value);
	if (parsed === null)
		return new Map();

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new MeleeCredentialCryptoError('MELEE_CREDENTIAL_PREVIOUS_KEYS_INVALID', PREVIOUS_KEYS_INVALID);
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

/**
 * The environment names behind the keyring config above, as the operator sets them.
 * The same convention as `ABLY_API_KEY_SETTING`: these exist so a refusal can name
 * the setting an operator must fix, and they live here because this module is the
 * one that reads them.
 */
const KEY_SETTING = 'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY';
const KEY_VERSION_SETTING = 'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION';
const PREVIOUS_KEYS_SETTING = 'NUXT_MELEE_CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS';

/**
 * The keyring-configuration half of `MeleeCredentialCryptoError`'s codes, each
 * paired with the sentence a response may carry for it (#347).
 *
 * The split is the #233 judgement applied to this subsystem: these five codes mean
 * the keyring itself is missing, incomplete, or unusable — an unfinished deployment
 * only the reader holding the response can finish — so their refusal names the
 * setting to fix, never a value and never the crypto library's own words. Every
 * other code (a corrupt envelope, a failed crypto operation) is a genuine internal
 * failure whose prose earns nothing; those stay out of this map and meet the 5xx
 * sanitizer.
 *
 * `MELEE_CREDENTIAL_KEY_MISSING` and `MELEE_CREDENTIAL_INVALID_KEY` name both key
 * settings because the code alone cannot say which side of the keyring the bad or
 * absent key came from: encryption reads the active key, decryption may reach a
 * retired one.
 */
const KEYRING_CONFIGURATION_FAULT_SENTENCES: Record<string, string> = {
	MELEE_CREDENTIAL_KEY_VERSION_MISSING: `${KEY_VERSION_SETTING} is not configured`,
	MELEE_CREDENTIAL_KEY_VERSION_INVALID: `${KEY_VERSION_SETTING} is not a usable key version`,
	MELEE_CREDENTIAL_KEY_MISSING: `${KEY_SETTING} or ${PREVIOUS_KEYS_SETTING} is missing a key version that stored Melee credentials need`,
	MELEE_CREDENTIAL_INVALID_KEY: `${KEY_SETTING} or ${PREVIOUS_KEYS_SETTING} carries a key that is not a valid AES-256 key`,
	MELEE_CREDENTIAL_PREVIOUS_KEYS_INVALID: `${PREVIOUS_KEYS_SETTING} is not a JSON object of key versions to base64 keys`,
};

/**
 * The public sentence for a keyring-configuration fault, or null for every other
 * failure. Structural rather than `instanceof`, like the `MELEE_UPSTREAM_FAILURE`
 * branch beside it in `mapPublicNitroError`: the code is the discriminator, so a
 * cause that crossed a module-registry boundary still classifies.
 */
export function meleeKeyringConfigurationFaultSentence(cause: unknown): string | null {
	if (!cause || typeof cause !== 'object' || !('code' in cause))
		return null;
	const code = (cause as { code: unknown }).code;
	return typeof code === 'string' ? KEYRING_CONFIGURATION_FAULT_SENTENCES[code] ?? null : null;
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
