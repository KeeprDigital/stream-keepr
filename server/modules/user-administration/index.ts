import type { H3Event } from 'h3';
import type {
	AdministeredUser,
	AdministeredUserList,
	AdministeredUserOutcome,
	BannedUserAccount,
	CreatedUserAccount,
	IssuedPasswordResetLink,
	PasswordResetLink,
	RevokedUserSessions,
} from '~~/shared/types/userAdministration';
import { assertPasswordWithinBounds, normalizeAccountEmail } from '~~/server/utils/betterAuthCredentials';
import { passwordResetLinkPath } from '~~/shared/utils/passwordResetLink';

/**
 * User administration (#399, ADR-0010): the surface an administrator creates
 * accounts, hands out reset links, bans, and revokes sessions from.
 *
 * ADR-0010 settles the shape of this and leaves the mechanism to be found. Its
 * two load-bearing clauses:
 *
 * - **No self-signup and no email sender.** An invite is an account created
 *   here plus a single-use, expiring reset link the administrator hands over
 *   out of band. Nothing is sent anywhere; the link is the deliverable.
 * - **Gated as the other administrator surfaces are.** `x-graphics-admin-token`
 *   alone admits a caller, exactly today's posture, and roles stay out of
 *   scope. The token's name is a leftover from the surface it first guarded —
 *   the roles-and-permissions effort ADR-0010 names as successor work is where
 *   that gets redrawn, not here.
 *
 * The Better Auth half is `./betterAuthPort`, kept apart for the reason the
 * first-admin bootstrap keeps its own apart: the admin plugin's endpoints all
 * sit behind an admin **session**, which this surface does not have and by
 * ADR-0010's posture is not going to acquire. What that costs is recorded
 * beside each operation there and proved in the port's tests, so a version bump
 * that changes it fails a test instead of a production reset.
 */

/**
 * How long a reset link stays redeemable.
 *
 * Twenty-four hours, because the handover is a human one: an administrator
 * creates the account and pastes the link into team chat, and the person it is
 * for may be asleep, travelling, or on the other side of the world. An hour —
 * Better Auth's own default for the self-serve flow it is protecting — would
 * turn a routine invite into a two-person appointment. A day is still short
 * enough that a link found later in a chat scrollback is dead.
 *
 * **Not `emailAndPassword.resetPasswordTokenExpiresIn`**, deliberately. That
 * option is read by exactly one endpoint, `/api/auth/request-password-reset`,
 * and this installation configures no `sendResetPassword`, so that endpoint
 * answers 400 and no self-serve reset exists — which is ADR-0010's "no
 * self-signup, no email sender" holding at the library's own boundary. Setting
 * the option would describe a flow nobody can reach. The expiry that governs the
 * link this surface hands out is the one written onto the verification row
 * below, and `/api/auth/reset-password` enforces it when it consumes it.
 */
export const PASSWORD_RESET_LINK_LIFETIME_SECONDS = 60 * 60 * 24;

/**
 * The most accounts one listing returns.
 *
 * ADR-0010's installation is single-tenant with a small invited team, so this
 * is a backstop rather than a page size, and there is deliberately no pager:
 * paging controls for a list that will hold a dozen rows is UI nobody needs and
 * a parameter every caller has to get right. `AdministeredUserList` carries the
 * true `total` alongside the capped rows so a surface that ever does exceed
 * this says so out loud rather than quietly administering a subset.
 */
export const USER_LIST_CAP = 200;

/**
 * What administering users needs from Better Auth, named as an interface so
 * every decision below can be exercised without a database.
 *
 * `./betterAuthPort` is the implementation, and the only place that knows which
 * half of Better Auth each operation has to come from.
 */
export interface UserAdministrationPort {
	/** Better Auth's configured bounds, read rather than restated. */
	readonly minPasswordLength: number;
	readonly maxPasswordLength: number;
	listUsers: (limit: number) => Promise<{ users: readonly AdministeredUser[]; total: number }>;
	findByEmail: (email: string) => Promise<AdministeredUser | null>;
	findById: (userId: string) => Promise<AdministeredUser | null>;
	createUser: (input: { email: string; name: string }) => Promise<AdministeredUser>;
	setPassword: (userId: string, password: string) => Promise<void>;
	/** Mints one single-use reset token redeemable until `expiresAt`. */
	issuePasswordResetToken: (userId: string, expiresAt: Date) => Promise<string>;
	setBan: (userId: string, ban: { banned: boolean; banReason: string | null }) => Promise<AdministeredUser>;
	countSessions: (userId: string) => Promise<number>;
	revokeSessions: (userId: string) => Promise<void>;
}

/**
 * The two things a decision needs from the request it is answering: when it is
 * happening, and which address the installation was reached on.
 *
 * The origin is taken from the request rather than configured because a reset
 * link has to be followable from wherever the administrator is looking at the
 * surface — a preview deployment, `localhost`, the production hostname — and a
 * configured base URL would hand out links pointing at a different
 * installation's login form. It is only ever pasted into the link, never
 * compared against anything, so a spoofed `Host` costs an administrator a link
 * that does not work rather than costing the installation anything.
 */
export interface UserAdministrationContext {
	readonly now: Date;
	readonly origin: string;
}

/**
 * The context this request establishes, read once so seven routes cannot
 * disagree about where a reset link points.
 */
export function userAdministrationContext(event: H3Event): UserAdministrationContext {
	return { now: new Date(), origin: getRequestURL(event).origin };
}

/**
 * The account a route names in its path.
 *
 * A missing parameter becomes an empty id rather than a refusal of its own,
 * because the routes that take one all look the account up first and answer
 * 404 — and an id that matches nothing is exactly what an absent one is.
 */
export function administeredUserIdFrom(event: H3Event): string {
	return getRouterParam(event, 'userId') ?? '';
}

export interface CreateUserAccountRequest {
	readonly email: string;
	readonly name: string;
}

/** Every account this installation holds, capped. */
export async function listUserAccounts(port: UserAdministrationPort): Promise<AdministeredUserList> {
	const { users, total } = await port.listUsers(USER_LIST_CAP);

	return { users: [...users], total, cap: USER_LIST_CAP };
}

/**
 * Create an account, and mint the link that gives it its first password.
 *
 * **Creation never takes a password.** ADR-0010 spells an invite as "create
 * plus a single-use expiring reset link", and doing it that way buys a property
 * worth keeping: an account's first credential is always chosen by the person
 * who will use it, so no administrator is ever holding a password that still
 * works. The direct set below exists for the different situation — someone
 * locked out mid-show with the administrator standing next to them.
 *
 * The account is created before the link is minted, so a mint that fails leaves
 * an account with no password and no link, which
 * `issuePasswordResetLinkForUser` fixes in one call. The other order would
 * leave a live reset token pointing at no account.
 */
export async function createUserAccount(
	port: UserAdministrationPort,
	request: CreateUserAccountRequest,
	context: UserAdministrationContext,
): Promise<CreatedUserAccount> {
	const email = normalizeAccountEmail(request.email);
	const name = request.name.trim();

	if (!name) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Bad Request',
			message: 'A name is required',
		});
	}

	// Asked before creating rather than left to the unique index, because the
	// index's failure is a 500 with a SQLite sentence in it and this one tells an
	// administrator the thing they need to know: the person already has an
	// account, so what they want is a reset link and not a second account.
	if (await port.findByEmail(email)) {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'An account already exists for that email',
		});
	}

	const user = await port.createUser({ email, name });

	return { user, passwordResetLink: await mintPasswordResetLink(port, user.id, context) };
}

/**
 * A fresh reset link for an account that already exists.
 *
 * **Minting one revokes nothing; redeeming one revokes everything.** The two
 * halves are deliberately split. Issuing a link is an administrator offering
 * somebody a way back in, and ending their sessions at that moment would punish
 * an account for being *sent* a link it has not used — a link an administrator
 * might issue and the person never open. Redemption is the account itself
 * saying "this is my password now", and `revokeSessionsOnPasswordReset` (see
 * `authOptions.ts`) ends every older session at that point, so a stolen session
 * does not outlive the password it was stolen alongside.
 *
 * Nothing in that can cost a show its output: a Screen Output holds no session,
 * being authorized by the capability in its URL hash. When an administrator
 * wants sessions ended *now*, without waiting for anybody to redeem anything,
 * `revokeUserSessions` and `banUserAccount` are on the same surface.
 */
export async function issuePasswordResetLinkForUser(
	port: UserAdministrationPort,
	userId: string,
	context: UserAdministrationContext,
): Promise<IssuedPasswordResetLink> {
	const user = await requireAccount(port, userId);

	return { user, passwordResetLink: await mintPasswordResetLink(port, user.id, context) };
}

/**
 * Set an account's password outright.
 *
 * The bounds are Better Auth's own, read from the running configuration rather
 * than restated, so this surface cannot admit a password the sign-in path would
 * then refuse. The check has to happen here: the port sets the credential
 * through Better Auth's internal hasher, which enforces neither bound — the
 * endpoint that does is the one this surface cannot call.
 */
export async function setUserAccountPassword(
	port: UserAdministrationPort,
	userId: string,
	password: string,
): Promise<AdministeredUserOutcome> {
	const user = await requireAccount(port, userId);

	assertPasswordWithinBounds(port, password);
	await port.setPassword(user.id, password);

	return { user };
}

/**
 * Ban an account, and end every session it currently holds.
 *
 * The revocation is not optional decoration. Better Auth enforces a ban when a
 * session is **created** — its admin plugin refuses `session.create` for a
 * banned user — so a ban on its own stops the next sign-in and leaves whoever
 * is already signed in working normally for up to the seven days ADR-0010 gives
 * a session. Better Auth's own `banUser` revokes for exactly this reason; this
 * surface cannot call it, so it does the same thing itself.
 *
 * **No ban expiry.** Better Auth carries a `banExpires` column and this surface
 * never writes it: a ban here is an administrative act somebody performs and
 * somebody lifts, and a self-lifting ban is a security decision made by a
 * timer nobody is watching. Unbanning is one call on the same surface.
 */
export async function banUserAccount(
	port: UserAdministrationPort,
	userId: string,
	banReason: string | null,
): Promise<BannedUserAccount> {
	await requireAccount(port, userId);

	const user = await port.setBan(userId, { banned: true, banReason: banReason?.trim() || null });
	const revokedSessionCount = await port.countSessions(userId);
	await port.revokeSessions(userId);

	return { user, revokedSessionCount };
}

/** Lift a ban, leaving the account's password exactly as it was. */
export async function unbanUserAccount(
	port: UserAdministrationPort,
	userId: string,
): Promise<AdministeredUserOutcome> {
	await requireAccount(port, userId);

	return { user: await port.setBan(userId, { banned: false, banReason: null }) };
}

/**
 * End every session an account holds, without changing anything else about it.
 *
 * The one action on this surface that answers "this person's laptop was left
 * open in the production office" without also locking them out of their own
 * account: they sign in again with the password they already have.
 */
export async function revokeUserSessions(
	port: UserAdministrationPort,
	userId: string,
): Promise<RevokedUserSessions> {
	const user = await requireAccount(port, userId);

	const revokedSessionCount = await port.countSessions(userId);
	await port.revokeSessions(userId);

	return { user, revokedSessionCount };
}

/**
 * The account, or the 404 every operation on a named account owes.
 *
 * Read first and refused here rather than at whichever internal adapter call
 * happens to notice, so an administrator acting on a row somebody else has just
 * deleted is told so instead of getting a write that silently affected nothing.
 */
async function requireAccount(
	port: UserAdministrationPort,
	userId: string,
): Promise<AdministeredUser> {
	const user = await port.findById(userId);

	if (!user) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'No such account',
		});
	}

	return user;
}

/**
 * One token, one expiry, one absolute URL.
 *
 * The origin is joined by `URL` rather than by string concatenation so an
 * origin arriving with a trailing slash cannot produce `https://host//reset…`,
 * which is a path this application does not serve and a link an administrator
 * would have handed over before finding out.
 */
async function mintPasswordResetLink(
	port: UserAdministrationPort,
	userId: string,
	context: UserAdministrationContext,
): Promise<PasswordResetLink> {
	const expiresAt = new Date(context.now.getTime() + PASSWORD_RESET_LINK_LIFETIME_SECONDS * 1000);
	const token = await port.issuePasswordResetToken(userId, expiresAt);

	return {
		url: new URL(passwordResetLinkPath(token), context.origin).href,
		expiresAt: expiresAt.toISOString(),
	};
}
