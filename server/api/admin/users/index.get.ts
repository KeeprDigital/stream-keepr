import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { listUserAccounts } from '~~/server/modules/user-administration';
import { betterAuthUserAdministrationPort } from '~~/server/modules/user-administration/betterAuthPort';

/**
 * `GET /api/admin/users` — every account this installation holds (#399).
 *
 * Under `/api/admin/` and guarded by `requireGraphicsAdministrator`, which is
 * ADR-0010's posture stated exactly: the shared `x-graphics-admin-token` alone
 * admits a caller here, the deny-by-default session boundary exempts the whole
 * prefix, and the guard on this line is therefore the only thing between this
 * listing and the internet. The token's name belongs to the surface it first
 * guarded; redrawing that seam is the roles-and-permissions effort ADR-0010
 * names as successor work, not this ticket.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAdministrator(event);

	return listUserAccounts(await betterAuthUserAdministrationPort());
});
