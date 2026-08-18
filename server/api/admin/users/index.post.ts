import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { createUserAccount, userAdministrationContext } from '~~/server/modules/user-administration';
import { betterAuthUserAdministrationPort } from '~~/server/modules/user-administration/betterAuthPort';
import { createUserAccountSchema } from '~~/server/schemas/api/userAdministration';

/**
 * `POST /api/admin/users` — the invite (#399, ADR-0010).
 *
 * Creates the account with no password at all and answers with a single-use,
 * expiring reset link the administrator hands over out of band. There is no
 * email sender in this installation, so the link in this response is the whole
 * of the invite: it is returned once, by the call that mints it, and no route
 * reads it back.
 *
 * The response therefore carries a credential, which is why this is the one
 * shape on the surface worth being careful with — it is never logged, never
 * listed, and an administrator who loses it before handing it over issues
 * another rather than recovering this one.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAdministrator(event);
	const body = await readValidatedBody(event, createUserAccountSchema.parse);

	return createUserAccount(
		await betterAuthUserAdministrationPort(),
		body,
		userAdministrationContext(event),
	);
});
