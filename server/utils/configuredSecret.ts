import { ServiceConfigurationError } from './errors';

const SECRET_NOT_TEXT_CLAUSE
	= 'does not read as text (a value of only digits, true/false or JSON is read as another type), so it cannot be checked: set one that contains a letter';

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
 */
export function readConfiguredSecret(value: unknown, settingName: string): string {
	if (value === undefined || value === null)
		return '';
	if (typeof value !== 'string')
		throw new ServiceConfigurationError(settingName, SECRET_NOT_TEXT_CLAUSE);
	return value.trim();
}
