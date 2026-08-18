/**
 * What the user administration surface says about accounts (#399, ADR-0010).
 *
 * Shared rather than server-only because the administrator page renders every
 * one of these shapes, and a response type restated in the page is a contract
 * with a copy of itself.
 *
 * **Nothing here carries a credential.** Not a password, not a password hash,
 * not a session token — a listing that leaked any of them would hand the whole
 * installation to anyone who reached the surface once. The one secret this API
 * ever emits is a freshly minted reset link, and it is emitted by the call that
 * mints it and never read back afterwards.
 */

/** One account, as an administrator sees it. */
export interface AdministeredUser {
	readonly id: string;
	readonly email: string;
	readonly name: string;
	/**
	 * Better Auth's role column, shown but never acted on.
	 *
	 * ADR-0010 puts roles out of scope: this surface is gated by the shared
	 * `x-graphics-admin-token`, and no route in this application asks what role
	 * an account holds. It is here because the first-admin bootstrap writes
	 * `admin` and an administrator reading the list should see the same word the
	 * database holds rather than wonder where it went.
	 */
	readonly role: string | null;
	readonly banned: boolean;
	readonly banReason: string | null;
	/** ISO 8601, as every instant on an administrator surface is. */
	readonly createdAt: string;
}

/**
 * The account listing.
 *
 * `total` is counted rather than derived from `users.length`, because the list
 * is capped: an installation holding more accounts than `cap` shows the first
 * page of them and has to be able to say so.
 */
export interface AdministeredUserList {
	readonly users: readonly AdministeredUser[];
	readonly total: number;
	readonly cap: number;
}

/**
 * A minted reset link, returned exactly once — by the call that minted it.
 *
 * There is no route that reads an outstanding link back. The token is stored
 * only as the verification row Better Auth consumes, so an administrator who
 * loses the link before handing it over issues another one rather than
 * recovering this one.
 */
export interface PasswordResetLink {
	/** The absolute URL to hand over, token in its fragment. */
	readonly url: string;
	/** ISO 8601. After this the link is refused and a new one is needed. */
	readonly expiresAt: string;
}

/** A created account and the link that gives it its first password. */
export interface CreatedUserAccount {
	readonly user: AdministeredUser;
	readonly passwordResetLink: PasswordResetLink;
}

/** An existing account and a fresh link for it. */
export interface IssuedPasswordResetLink {
	readonly user: AdministeredUser;
	readonly passwordResetLink: PasswordResetLink;
}

/** The account after an administrative change to it. */
export interface AdministeredUserOutcome {
	readonly user: AdministeredUser;
}

/**
 * The account after its sessions were ended, and how many ended.
 *
 * The count is what makes the action legible: "revoked 3 sessions" tells an
 * administrator the person really was signed in somewhere, and "revoked 0"
 * tells them the compromise they were chasing is not a live session. Only
 * sessions that had not already lapsed are counted — an expired row is not
 * something this action ended.
 */
export interface RevokedUserSessions {
	readonly user: AdministeredUser;
	readonly revokedSessionCount: number;
}

/**
 * The account after a ban, and how many sessions the ban ended.
 *
 * Structurally what a revocation answers, and named separately because it is
 * not one: Better Auth enforces a ban when a session is *created*, so banning
 * has to revoke as well, and a response typed `RevokedUserSessions` would read
 * as though the ban were the side effect rather than the point.
 */
export interface BannedUserAccount {
	readonly user: AdministeredUser;
	readonly revokedSessionCount: number;
}
