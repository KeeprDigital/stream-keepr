import { ServiceConfigurationError } from './errors';

const SECRET_NOT_TEXT_CLAUSE
	= 'does not read as text (a value of only digits, true/false or JSON is read as another type), so it cannot be checked: set one that contains a letter';

/**
 * The fewest characters a shared secret a caller presents in a header may have.
 *
 * Nothing throttles guesses at those surfaces, so the secret's length is the
 * whole defence. README and `.env.example` generate one with
 * `openssl rand -base64 32`, which is 44 characters; 32 is what 128 bits come
 * to in hex, the shortest spelling of a secret that generous.
 */
export const SHARED_SECRET_MIN_LENGTH = 32;

/**
 * A secret's configured value as text, trimmed, or `''` when it is unset.
 *
 * Nuxt reads every `NUXT_*` value through `destr`, so a secret an operator types
 * as only digits reaches runtimeConfig as a number, `true` as a boolean, and
 * anything JSON-shaped as an object. None of those can be compared as the token
 * the operator will type, and a number has already lost any leading zeros, so
 * converting back would be a guess. Production met this on its first bootstrap
 * as an unhandled `TypeError` 500 that named nothing; refusing instead names the
 * setting and what to change, the way a blank secret is refused.
 *
 * With `minLength`, a value shorter than it also reads as `''`: its surface
 * stays unarmed, as if nothing were set, and the log says why. It does not
 * raise, so a weak secret costs its own surface and nothing else.
 */
export function readConfiguredSecret(
	value: unknown,
	settingName: string,
	options: { minLength?: number } = {},
): string {
	if (value === undefined || value === null)
		return '';
	if (typeof value !== 'string')
		throw new ServiceConfigurationError(settingName, SECRET_NOT_TEXT_CLAUSE);

	const secret = value.trim();
	if (secret && options.minLength !== undefined && secret.length < options.minLength) {
		console.error(JSON.stringify({
			event: 'configured_secret_too_short',
			setting: settingName,
			minLength: options.minLength,
			message: `${settingName} is shorter than ${options.minLength} characters, so it is treated as not configured: generate one with \`openssl rand -base64 32\``,
		}));
		return '';
	}
	return secret;
}
