import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { administeredUserIdFrom, revokeUserSessions } from '~~/server/modules/user-administration';
import { betterAuthUserAdministrationPort } from '~~/server/modules/user-administration/betterAuthPort';

/**
 * `DELETE /api/admin/users/:userId/sessions` — end every session an account
 * holds, and change nothing else about it (#399, ADR-0010's revocation clause).
 *
 * The answer to the abandoned shared machine, which is the risk ADR-0010
 * deliberately left to this route rather than to a short idle window: it chose
 * seven-day sessions because "a mid-show forced re-login is the costliest
 * failure this product can buy", and named admin revocation as what covers the
 * laptop left open in the production office instead.
 *
 * The person signs straight back in on their own machine — they keep their
 * password, and nothing here bans them.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAdministrator(event);

	return revokeUserSessions(await betterAuthUserAdministrationPort(), administeredUserIdFrom(event));
});
