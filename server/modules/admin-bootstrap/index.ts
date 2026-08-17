import type { H3Event } from 'h3';
import { ServiceConfigurationError } from '~~/server/utils/errors';
import { secretTokensMatch } from '~~/server/utils/secretTokenComparison';

/**
 * The first-admin bootstrap (#394, ADR-0010): the one way an installation with
 * no administrator acquires one.
 *
 * Every other route that can create a user is Better Auth's admin API, which
 * requires an admin session to call — so a fresh installation, and an
 * installation whose only admin has lost their password, can reach no account
 * creation at all. This design has no email sender, so a forgotten password is
 * otherwise recoverable only by hand-editing D1, which would orphan the
 * `initiatedBy` and Evidence Ledger references that point at user ids.
 *
 * The route this guards is therefore armed by a dedicated Worker secret and
 * disarmed by deleting it: while `NUXT_ADMIN_BOOTSTRAP_TOKEN` is blank the
 * route answers 503 naming the setting, exactly the `NUXT_GRAPHICS_ADMIN_TOKEN`
 * posture in `graphics-administrator.ts`. No stored self-limiting state — the
 * disarm is an operator step, documented in the README beside the ceremony that
 * needs it, because state that says "already used" is state that has to be
 * cleared by the same locked-out person who cannot sign in to clear it.
 *
 * The Better Auth half of the work is `./betterAuthPort`, kept apart so the
 * decisions below can be exercised without a database.
 */

/**
 * The environment name, not the runtimeConfig one, because the only reader who
 * can act on the refusal is the one who has to go and set it.
 */
export const ADMIN_BOOTSTRAP_TOKEN_ENV_NAME = 'NUXT_ADMIN_BOOTSTRAP_TOKEN';

/** The header the operator's curl presents the armed secret in. */
export const ADMIN_BOOTSTRAP_TOKEN_HEADER = 'x-admin-bootstrap-token';

/** The role Better Auth's admin plugin grants its user-management endpoints to. */
export const ADMIN_ROLE = 'admin';

/**
 * The bootstrap route's own credential, checked the way the Graphics
 * Administrator token is.
 *
 * A separate secret rather than a reuse of the Graphics Administrator token,
 * deliberately: that one is a standing installation credential which lives set,
 * and this one is armed for a minute and deleted. Sharing them would mean an
 * installation could not disarm account creation without also turning off
 * Graphics Administrator operations.
 */
export async function requireAdminBootstrapToken(event: H3Event) {
	const configuredToken = useRuntimeConfig(event).adminBootstrapToken.trim();
	if (!configuredToken) {
		// Both the H3 error and its cause: the status is right on its own, and the
		// cause is what carries the message past the 5xx sanitizer in
		// `mapPublicNitroError` (#321). Without it a disarmed installation answers
		// 'Internal Server Error', which reads as a broken route rather than as the
		// deliberate resting state of this one. No `retry-after`: an unset name is
		// not something waiting fixes, and here the unset state is usually correct.
		const cause = new ServiceConfigurationError(
			ADMIN_BOOTSTRAP_TOKEN_ENV_NAME,
			'is not configured, so first-admin bootstrap is unavailable',
		);
		throw createError({
			statusCode: cause.statusCode,
			statusMessage: 'Service Unavailable',
			message: cause.message,
			cause,
		});
	}

	const suppliedToken = getRequestHeader(event, ADMIN_BOOTSTRAP_TOKEN_HEADER)?.trim() ?? '';
	if (!suppliedToken || !(await secretTokensMatch(suppliedToken, configuredToken))) {
		throw createError({
			statusCode: 403,
			statusMessage: 'Forbidden',
			message: 'First-admin bootstrap authorization is required',
		});
	}
}

/** As much of an existing account as the ensure decision reads. */
export interface AdminBootstrapAccount {
	readonly id: string;
	/** Better Auth stores roles as one comma-separated string, or null for none. */
	readonly role?: string | null;
}

/**
 * What ensuring an admin needs from Better Auth, named as an interface so the
 * decision below can be exercised without a database.
 *
 * `./betterAuthPort` is the implementation, and the only place that knows which
 * half of Better Auth each operation comes from.
 */
export interface AdminBootstrapPort {
	readonly minPasswordLength: number;
	readonly maxPasswordLength: number;
	findByEmail: (email: string) => Promise<AdminBootstrapAccount | null>;
	createAdmin: (input: { email: string; password: string; name: string }) => Promise<AdminBootstrapAccount>;
	setPassword: (userId: string, password: string) => Promise<void>;
	/** Writes the whole role string, as Better Auth stores it. */
	setRoles: (userId: string, roles: string) => Promise<void>;
}

export interface EnsureAdminRequest {
	readonly email: string;
	readonly password: string;
	/** Display name, used only where the account is created. */
	readonly name?: string;
}

export interface EnsureAdminOutcome {
	/** Which ensure branch ran, so the operator's curl says what it did. */
	readonly outcome: 'created' | 'updated';
	readonly userId: string;
	/** The normalized email the account is keyed on, which may differ from what was sent. */
	readonly email: string;
	/** Whether the account gained an admin role it did not have. */
	readonly grantedAdminRole: boolean;
}

/**
 * Better Auth lowercases an email before storing one, so a lookup that did not
 * would miss the account it is about to duplicate — and `createUser` refuses a
 * duplicate email, which would turn a break-glass reset into a 400 at exactly
 * the worst moment.
 */
export function normalizeBootstrapEmail(email: string) {
	return email.trim().toLowerCase();
}

/** The roles a stored role string names; an absent or empty one names none. */
function parseRoles(role: string | null | undefined): string[] {
	return (role ?? '')
		.split(',')
		.map(entry => entry.trim())
		.filter(entry => entry.length > 0);
}

/**
 * Create-or-reset, as ADR-0010 specifies it: a new email becomes an admin
 * account, an existing one is given the supplied password and the admin role if
 * it lacks it.
 *
 * Idempotent by construction — the same body twice leaves one account in the
 * same state — which is what makes it safe to hand an operator who cannot tell
 * whether the first curl landed. Create-only would leave a locked-out
 * installation holding an account it cannot sign in to under an email it cannot
 * reuse.
 *
 * **An existing account keeps its name.** This path is break-glass, and
 * overwriting a display name — which the Evidence Ledger resolves at read time,
 * so it is what past entries are attributed to — because a curl omitted one
 * would rewrite the record of who did something.
 *
 * **A ban is not lifted here.** Banning is a deliberate administrative act and
 * quietly undoing it would make this route the way around it. An installation
 * whose only admin is banned is a lockout this route does not answer, recorded
 * rather than half-answered.
 */
export async function ensureAdminAccount(
	port: AdminBootstrapPort,
	request: EnsureAdminRequest,
): Promise<EnsureAdminOutcome> {
	const email = normalizeBootstrapEmail(request.email);

	// Better Auth's own bounds, read from the running configuration rather than
	// copied, so a changed `minPasswordLength` cannot leave this route admitting
	// a password the sign-in path would then reject. The check has to be here:
	// `createUser` — unlike `signUpEmail` and `setUserPassword` — enforces
	// neither bound, so without it an empty password hashes and stores happily
	// and the installation's first admin has no password at all.
	if (request.password.length < port.minPasswordLength) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Bad Request',
			message: `Password must be at least ${port.minPasswordLength} characters`,
		});
	}
	if (request.password.length > port.maxPasswordLength) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Bad Request',
			message: `Password must be at most ${port.maxPasswordLength} characters`,
		});
	}

	const existing = await port.findByEmail(email);
	if (!existing) {
		const created = await port.createAdmin({
			email,
			password: request.password,
			name: request.name?.trim() || email,
		});
		return { outcome: 'created', userId: created.id, email, grantedAdminRole: true };
	}

	await port.setPassword(existing.id, request.password);

	const roles = parseRoles(existing.role);
	const grantedAdminRole = !roles.includes(ADMIN_ROLE);
	if (grantedAdminRole) {
		// Appended rather than replaced: whatever else this account is, it stays
		// that as well as an admin.
		await port.setRoles(existing.id, [...roles, ADMIN_ROLE].join(','));
	}

	return { outcome: 'updated', userId: existing.id, email, grantedAdminRole };
}
