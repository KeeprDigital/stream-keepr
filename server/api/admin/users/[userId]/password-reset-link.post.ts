import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import {
	administeredUserIdFrom,
	issuePasswordResetLinkForUser,
	userAdministrationContext,
} from '~~/server/modules/user-administration';
import { betterAuthUserAdministrationPort } from '~~/server/modules/user-administration/betterAuthPort';

/**
 * `POST /api/admin/users/:userId/password-reset-link` — a fresh reset link for
 * an account that already exists (#399).
 *
 * A `POST` rather than a `GET` because it mints a credential: the token does
 * not exist until this is called, and a route that created one on a read could
 * be triggered by a link preview or a retry.
 *
 * It does not end the account's sessions. The commonest reason to issue one of
 * these is a forgotten password, and signing an operator out of a control
 * surface mid-show to answer that would be the surface guessing; the
 * administrator has `sessions.delete` and `ban.post` here for when they mean
 * something stronger.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAdministrator(event);

	return issuePasswordResetLinkForUser(
		await betterAuthUserAdministrationPort(),
		administeredUserIdFrom(event),
		userAdministrationContext(event),
	);
});
