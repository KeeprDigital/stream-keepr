import type { ServerAuth } from '~~/server/utils/auth';
import type { AdminBootstrapPort } from '.';
import { serverAuth } from '~~/server/utils/auth';
import { ADMIN_ROLE } from '.';

/**
 * The bootstrap's `AdminBootstrapPort`, in terms of Better Auth.
 *
 * **Why this is two halves rather than one.** ADR-0010 asks for the whole
 * ensure to go through Better Auth's server-side admin API, so that `user` and
 * `account` rows are always library-shaped. Half of it can:
 * `auth.api.createUser` admits a sessionless server-side call, by design — it
 * refuses only when a request or headers are present without a session
 * (`node_modules/better-auth/dist/plugins/admin/routes.mjs`), which is exactly
 * the "called from your own server, not from a browser" case.
 *
 * `auth.api.setUserPassword` does not: it sits behind the admin plugin's
 * `adminMiddleware`, which requires an admin session unconditionally. That is
 * the chicken-and-egg this whole route exists inside — the endpoint that resets
 * an admin's password can only be called by an admin who can already sign in.
 * `test/integration/adminBootstrap.test.ts` proves the refusal rather than
 * asserting it from the source, because it is the reason the reset half is
 * written this way and a version bump could change it.
 *
 * So the reset half goes through `auth.$context` — Better Auth's own internal
 * adapter and password hasher, which is precisely what `setUserPassword` runs
 * once its session check passes. Nothing here writes SQL, invents an id, or
 * spells a hash: the rows stay library-shaped, which is what the ADR's
 * requirement is protecting.
 *
 * The instance is a parameter defaulting to this installation's, so the port
 * can be built over a throwaway Better Auth in the unit suite and the two
 * paragraphs above can be facts a test establishes rather than claims a
 * docblock makes.
 */
/**
 * Better Auth packs an account's roles into one comma-separated column, and
 * this pair of functions is the whole of where that is known. Its own
 * `parseRoles` joins an array the same way (`plugins/admin/routes.mjs`); these
 * are the reading half it has no export for.
 */
function decodeRoles(role: string | null | undefined): string[] {
	return (role ?? '')
		.split(',')
		.map(entry => entry.trim())
		.filter(entry => entry.length > 0);
}

function encodeRoles(roles: readonly string[]): string {
	return roles.join(',');
}

export async function betterAuthBootstrapPort(
	auth: ServerAuth = serverAuth(),
): Promise<AdminBootstrapPort> {
	const context = await auth.$context;

	return {
		// Better Auth's configured bounds, read rather than restated, so this route
		// and the sign-in path cannot disagree about what a password may be.
		minPasswordLength: context.password.config.minPasswordLength,
		maxPasswordLength: context.password.config.maxPasswordLength,

		findByEmail: async (email) => {
			const found = await context.internalAdapter.findUserByEmail(email);
			if (!found)
				return null;

			// `role` is the admin plugin's additional field: it is on the row and on
			// the schema this repo maintains (`server/db/schema/auth.ts`), but not on
			// the base `User` the internal adapter is typed against. Narrowed here
			// rather than anywhere the decision can see it, so exactly one line in
			// this module knows the library's typing stops short of its own storage.
			const { role } = found.user as { role?: string | null };
			return { id: found.user.id, roles: decodeRoles(role) };
		},

		createAdmin: async ({ email, password, name }) => {
			// No `headers`, deliberately: passing the operator's request headers
			// through would put this call on the "browser asked" side of
			// `createUser`'s own check and it would refuse with 401. The token guard
			// on the route is this call's authorization.
			const { user } = await auth.api.createUser({
				body: { email, password, name, role: ADMIN_ROLE },
			});
			// The role is what was asked for rather than what came back: this
			// response is typed without the admin plugin's fields, and reading it
			// through a cast would be inventing a fact. The role is asserted where
			// it can be — against the stored account, in the tests.
			return { id: user.id, roles: [ADMIN_ROLE] };
		},

		setPassword: async (userId, password) => {
			const hashedPassword = await context.password.hash(password);
			const accounts = await context.internalAdapter.findAccounts(userId);
			// A user created for a future sign-in method — or by a version that
			// stopped writing one — has no credential account to update. Creating it
			// is what `setUserPassword` does in the same case, and skipping it would
			// leave a break-glass reset reporting success over an account that still
			// cannot sign in.
			if (accounts.some(account => account.providerId === 'credential'))
				await context.internalAdapter.updatePassword(userId, hashedPassword);
			else
				await context.internalAdapter.createAccount({ userId, providerId: 'credential', accountId: userId, password: hashedPassword });
		},

		setRoles: async (userId, roles) => {
			await context.internalAdapter.updateUser(userId, { role: encodeRoles(roles) });
		},
	};
}
