import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { administeredUserIdFrom, unbanUserAccount } from '~~/server/modules/user-administration';
import { betterAuthUserAdministrationPort } from '~~/server/modules/user-administration/betterAuthPort';

/**
 * `DELETE /api/admin/users/:userId/ban` — lift a ban (#399).
 *
 * The account signs back in with the password it already had: a ban is a
 * refusal to create sessions, not a change to the credential, so lifting one
 * restores exactly what banning suspended. This is also the whole of why this
 * surface writes no ban expiry — a ban ends when somebody decides it ends, and
 * that decision is this route.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAdministrator(event);

	return unbanUserAccount(await betterAuthUserAdministrationPort(), administeredUserIdFrom(event));
});
