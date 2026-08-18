import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { administeredUserIdFrom, setUserAccountPassword } from '~~/server/modules/user-administration';
import { betterAuthUserAdministrationPort } from '~~/server/modules/user-administration/betterAuthPort';
import { setUserPasswordSchema } from '~~/server/schemas/api/userAdministration';

/**
 * `PUT /api/admin/users/:userId/password` — set an account's password outright
 * (#399, ADR-0010's `setUserPassword` clause).
 *
 * The blunt instrument beside the reset link, and it exists for the situation
 * the link cannot answer: somebody locked out mid-show with the administrator
 * standing next to them, where an out-of-band handover is a round trip nobody
 * has. Everything else should be a link — this path leaves an administrator
 * holding a password that works.
 *
 * A body rather than a query string, for the reason the first-admin bootstrap
 * gives: a password in a query string is logged by every proxy in between.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAdministrator(event);
	const body = await readValidatedBody(event, setUserPasswordSchema.parse);

	return setUserAccountPassword(
		await betterAuthUserAdministrationPort(),
		administeredUserIdFrom(event),
		body.password,
	);
});
