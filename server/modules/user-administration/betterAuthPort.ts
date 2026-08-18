import type { ServerAuth } from '~~/server/utils/auth';
import type { UserAdministrationAccount, UserAdministrationPort } from '.';
import { serverAuth } from '~~/server/utils/auth';

/**
 * User administration's `UserAdministrationPort`, in terms of Better Auth.
 *
 * **Why almost none of this goes through `auth.api`.** ADR-0010 keeps the admin
 * plugin for exactly these operations, and the plugin does expose every one of
 * them — behind `adminMiddleware`, which requires an admin **session**
 * unconditionally. This surface is gated by the shared
 * `x-graphics-admin-token`, which ADR-0010 leaves untouched until a
 * roles-and-permissions effort redraws that seam, so there is no session to
 * present and no way to acquire one that would not be an administrator signing
 * in as somebody. `auth.api.createUser` is the single exception: it admits a
 * sessionless server-side call by design, refusing only when a request or
 * headers arrive without a session. `userAdministrationPort.test.ts` calls all
 * seven and records what each answers, so this paragraph is a fact a test
 * establishes rather than a claim a docblock makes.
 *
 * The rest goes through `auth.$context` — Better Auth's own internal adapter,
 * password hasher, and id generator, which is precisely what those endpoints
 * run once their session check passes. Nothing here writes SQL, invents an id,
 * or spells a hash: the rows stay library-shaped, which is what the ADR's
 * "through Better Auth" requirement is protecting.
 *
 * The instance is a parameter defaulting to this installation's, so the port
 * can be built over a throwaway Better Auth in the unit suite.
 */
export async function betterAuthUserAdministrationPort(
	auth: ServerAuth = serverAuth(),
): Promise<UserAdministrationPort> {
	const context = await auth.$context;

	return {
		// Better Auth's configured bounds, read rather than restated, so this
		// surface and the sign-in path cannot disagree about what a password may be.
		minPasswordLength: context.password.config.minPasswordLength,
		maxPasswordLength: context.password.config.maxPasswordLength,

		listUsers: async (limit) => {
			// Sorted by the column an administrator reads the list in. Better Auth's
			// own `listUsers` leaves the order to the adapter, which means "whatever
			// D1 returns" — fine for a query, wrong for a page somebody scans for a
			// name.
			const users = await context.internalAdapter.listUsers(
				limit,
				undefined,
				{ field: 'createdAt', direction: 'asc' },
			);

			return {
				users: users.map(toAccount),
				total: await context.internalAdapter.countTotalUsers(),
			};
		},

		findByEmail: async (email) => {
			const found = await context.internalAdapter.findUserByEmail(email);
			return found ? toAccount(found.user) : null;
		},

		findById: async (userId) => {
			const found = await context.internalAdapter.findUserById(userId);
			return found ? toAccount(found) : null;
		},

		createUser: async ({ email, name }) => {
			// No `headers`, deliberately: passing the administrator's request headers
			// through would put this call on the "a browser asked" side of
			// `createUser`'s own check and it would refuse with 401. The shared token
			// on the route is this call's authorization.
			//
			// No `password` and no `role` either. Without a password Better Auth
			// creates no `credential` account at all, which is the invite shape
			// ADR-0010 asks for — the first password is set by whoever redeems the
			// link. Without a role the plugin's own `defaultRole` applies, so an
			// invited operator cannot silently arrive as an administrator.
			const { user } = await auth.api.createUser({ body: { email, name } });

			// Read back rather than mapped from the response: `createUser` is typed
			// without the admin plugin's fields, so `role` and `banned` are not on
			// what it returns, and reading them through a cast would be inventing
			// facts about a row this can simply go and look at.
			const stored = await context.internalAdapter.findUserById(user.id);
			return stored ? toAccount(stored) : toAccount({ ...user, role: null });
		},

		setPassword: async (userId, password) => {
			const hashedPassword = await context.password.hash(password);
			const accounts = await context.internalAdapter.findAccounts(userId);
			// An invited account has no `credential` row until its link is redeemed,
			// and creating one here is what `setUserPassword` does in the same case.
			// Skipping it would leave this reporting success over an account that
			// still cannot sign in.
			if (accounts.some(account => account.providerId === 'credential'))
				await context.internalAdapter.updatePassword(userId, hashedPassword);
			else
				await context.internalAdapter.createAccount({ userId, providerId: 'credential', accountId: userId, password: hashedPassword });
		},

		issuePasswordResetToken: async (userId, expiresAt) => {
			const token = mintResetToken();
			// The identifier Better Auth's own `/reset-password` consumes, and the
			// value it reads a user id out of. Writing the row this way rather than
			// calling `requestPasswordReset` is what lets this installation have
			// reset links without configuring a `sendResetPassword` sender — which
			// would also arm a self-serve reset endpoint ADR-0010 does not want.
			//
			// `consumeVerificationValue` on the redemption side deletes the row it
			// returns and refuses an expired one, so single-use and expiring are
			// properties of the library's consumption rather than of this write.
			await context.internalAdapter.createVerificationValue({
				identifier: `reset-password:${token}`,
				value: userId,
				expiresAt,
			});

			return token;
		},

		setBan: async (userId, ban) => {
			const updated = await context.internalAdapter.updateUser(userId, {
				banned: ban.banned,
				banReason: ban.banReason,
				// Always cleared. This surface never sets a ban expiry (see the
				// module), and leaving a stale one behind would let a lifted-then-
				// reapplied ban expire on a timer set months earlier.
				banExpires: null,
				updatedAt: new Date(),
			});

			return toAccount(updated);
		},

		countSessions: async userId => (await context.internalAdapter.listSessions(userId)).length,

		revokeSessions: async (userId) => {
			await context.internalAdapter.deleteUserSessions(userId);
		},
	};
}

/**
 * How many random bytes a reset token carries.
 *
 * Thirty-two, because whoever holds this token can set the account's password:
 * it is a bearer credential with the weight of one, and it lives for a day in
 * somebody's chat history. Better Auth's own tokens are `generateId(24)`; this
 * is generated here rather than through that helper because the token's
 * strength is this installation's decision and not a detail to inherit from
 * whichever id scheme a version happens to ship.
 */
const RESET_TOKEN_BYTES = 32;

/**
 * One reset token: base64url, so it survives a URL fragment and a paste into a
 * chat window without an encoder changing it.
 *
 * `crypto.getRandomValues` rather than `Math.random` — the distance between the
 * two here is the distance between a credential and a guess — and Web Crypto
 * rather than `node:crypto` because this runs on workerd, the same reason
 * `secretTokenComparison.ts` gives.
 */
function mintResetToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(RESET_TOKEN_BYTES));

	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

/**
 * One Better Auth user row as this surface reports it.
 *
 * The narrowing is the point rather than a formality: the row carries the admin
 * plugin's fields Better Auth's own `User` type does not know about, and it
 * carries nothing this surface may publish beyond what is named here. A
 * spread-and-send would put whatever a future version adds to the table onto an
 * administrator's screen without anybody deciding to.
 */
function toAccount(row: Record<string, unknown>): UserAdministrationAccount {
	const { id, email, name, role, banned, banReason, createdAt } = row as {
		id: string;
		email: string;
		name: string;
		role?: string | null;
		banned?: boolean | null;
		banReason?: string | null;
		createdAt?: Date | string | null;
	};

	return {
		id,
		email,
		name,
		role: role ?? null,
		// `banned` is nullable in the schema — an account that has never been
		// banned holds `null`, not `false` — and a surface that showed three states
		// for a two-state fact would be reporting the storage rather than the
		// account.
		banned: banned === true,
		banReason: banReason ?? null,
		createdAt: createdAt ? new Date(createdAt).toISOString() : new Date(0).toISOString(),
	};
}
