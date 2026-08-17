import type { H3Event } from 'h3';
import { ServiceConfigurationError } from './errors';
import { secretTokensMatch } from './secretTokenComparison';

/**
 * A route surface guarded by one shared secret an operator sets and a caller
 * presents in a header.
 *
 * Two of them exist: Graphics Administrator operations, and the first-admin
 * bootstrap (#394). They were written out twice — same trim, same
 * `ServiceConfigurationError`-as-cause 503, same 403 — and the second copy was
 * a transcription of the first, comments included. What actually differs
 * between them is the four values below, which is a description of a type
 * rather than of two functions.
 *
 * The refusal *shape* is the thing worth having in one place. Both of its
 * halves are decisions this repo made painfully and could lose silently in a
 * copy: the cause that carries a 503's sentence past `mapPublicNitroError`'s
 * 5xx sanitizer (#233, #321 — without it an operator is told the server broke
 * when a name was blank), and the absence of `retry-after`, because nothing
 * about an unset name resolves by waiting.
 *
 * The *words* stay with each caller, because they are not interchangeable:
 * `build/devVars.ts` quotes the Graphics Administrator clause verbatim in the
 * notice a dev server prints, and a shared sentence would make that quotation
 * a lie about whichever surface it was not written for.
 */
export interface SharedSecretSurface {
	/**
	 * The configured secret as runtimeConfig holds it, read by the caller so the
	 * config key stays type-checked at the site that knows which key it is.
	 * Trimmed here; blank means the surface is not armed.
	 */
	readonly configuredToken: string;
	/**
	 * The environment name, not the runtimeConfig one, because the only reader
	 * who can act on the refusal is the one who has to go and set it.
	 */
	readonly settingName: string;
	/** Completes "<settingName> …", naming what is unavailable without it. */
	readonly unavailableClause: string;
	/** The header a caller presents the secret in. */
	readonly headerName: string;
	/** What a caller presenting the wrong secret, or none, is told. */
	readonly forbiddenMessage: string;
}

/**
 * Refuse the request unless it presents this surface's shared secret.
 *
 * Resolves silently where it admits, so a caller reads as a precondition rather
 * than as a branch — `await requireSharedSecret(event, …)` and carry on.
 */
export async function requireSharedSecret(event: H3Event, surface: SharedSecretSurface) {
	const configuredToken = surface.configuredToken.trim();
	if (!configuredToken) {
		const cause = new ServiceConfigurationError(surface.settingName, surface.unavailableClause);
		throw createError({
			statusCode: cause.statusCode,
			statusMessage: 'Service Unavailable',
			message: cause.message,
			cause,
		});
	}

	const suppliedToken = getRequestHeader(event, surface.headerName)?.trim() ?? '';
	if (!suppliedToken || !(await secretTokensMatch(suppliedToken, configuredToken))) {
		throw createError({
			statusCode: 403,
			statusMessage: 'Forbidden',
			message: surface.forbiddenMessage,
		});
	}
}
