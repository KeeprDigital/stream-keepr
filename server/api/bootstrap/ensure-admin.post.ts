import { ensureAdminAccount, requireAdminBootstrapToken } from '~~/server/modules/admin-bootstrap';
import { betterAuthBootstrapPort } from '~~/server/modules/admin-bootstrap/betterAuthPort';
import { ensureAdminSchema } from '~~/server/schemas/api/adminBootstrap';

/**
 * `POST /api/bootstrap/ensure-admin` — the secret-armed first-admin bootstrap
 * (#394, ADR-0010). Curl-only; the operator ceremony is in the README's Worker
 * secrets section: set the secret, call this once, delete the secret.
 *
 * **Every account this makes is an administrator**, and it grants the role to an
 * existing account that lacks one, so it cannot make an ordinary user even
 * deliberately. That is right for what it is for — install #1, and a lockout that
 * has lost every administrator — and wrong for everything else: since #399,
 * ordinary accounts come from `POST /api/admin/users`, which creates them with no
 * role and no password and answers with a Password Reset Link.
 * `docs/operations/identity-cutover.md` says which to reach for.
 *
 * **Not under `/api/admin/` or `/api/auth/`, deliberately.** Both prefixes
 * already mean something in the boundary ADR-0010 describes — `/api/admin/**`
 * is exempted by the Graphics Administrator token and `/api/auth/**` is Better
 * Auth's own router — and a path that merely *starts* like one of them invites
 * a prefix test to hand this route the wrong exemption. `/api/bootstrap/` can
 * be captured by neither, so its allowlist entry has to be written on purpose.
 *
 * It is a `POST` with a body rather than anything more convenient because a
 * password travels in it: a query string is logged by every proxy in between.
 */
export default defineEventHandler(async (event) => {
	await requireAdminBootstrapToken(event);
	const body = await readValidatedBody(event, ensureAdminSchema.parse);

	return ensureAdminAccount(await betterAuthBootstrapPort(), body);
});
