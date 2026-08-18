import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { administeredUserIdFrom, banUserAccount } from '~~/server/modules/user-administration';
import { betterAuthUserAdministrationPort } from '~~/server/modules/user-administration/betterAuthPort';
import { banUserAccountSchema } from '~~/server/schemas/api/userAdministration';

/**
 * `POST /api/admin/users/:userId/ban` — ban an account, and end every session
 * it currently holds (#399).
 *
 * The revocation is part of the ban rather than a second step an administrator
 * has to remember: Better Auth enforces a ban when a session is *created*, so a
 * ban alone stops the next sign-in and leaves anyone already signed in working
 * for up to the seven days ADR-0010 gives a session — which is the opposite of
 * what somebody pressing "ban" means. The response says how many sessions ended.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAdministrator(event);
	const body = await readValidatedBody(event, banUserAccountSchema.parse);

	return banUserAccount(
		await betterAuthUserAdministrationPort(),
		administeredUserIdFrom(event),
		body.reason ?? null,
	);
});
