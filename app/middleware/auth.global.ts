import { LOGIN_PATH, loginPathFor, pageRequiresSession, REDIRECT_QUERY, safeRedirectTarget } from '~/modules/auth/pageGate';
import { useAuthSession } from '~/modules/auth/session';

/**
 * The client-side page gate (#395, ADR-0010's page-gating line).
 *
 * UX, not security. The wall is the deny-by-default server middleware over
 * `/api/**`; this exists so a signed-out browser meets a login form instead of
 * a shell of pages whose every request comes back 401.
 *
 * An exempt page is left completely alone — not asked about a session, not
 * merely allowed past. That matters for the Screen Output page: a machine
 * showing program has no operator and no cookie, and an auth request from it
 * would be a request nobody is there to answer for.
 *
 * Only `signed-out` redirects. An `unavailable` answer means the browser could
 * not find out, and a gate that guessed there would take a control surface off
 * an operator mid-show over a blip — for a gate whose whole remit is UX, that
 * costs more than the shell it would have saved them from. `session.ts` carries
 * the rest of that argument.
 *
 * Nuxt runs global middleware in filename order, so this runs ahead of
 * `event.global` — the useful way round: a browser on its way to the login page
 * does not first load an Event it is not going to be shown.
 */
export default defineNuxtRouteMiddleware(async (to) => {
	// The login page is exempt from the gate and is still the one page whose
	// own answer depends on the session: an operator who already has one has no
	// business looking at a password field, and following the `?redirect=` they
	// arrived with lands them where they were going.
	if (to.path === LOGIN_PATH) {
		if (await useAuthSession().ensure() === 'signed-in')
			return navigateTo(safeRedirectTarget(to.query[REDIRECT_QUERY]) ?? '/');

		return;
	}

	if (!pageRequiresSession(to.path))
		return;

	if (await useAuthSession().ensure() === 'signed-out')
		return navigateTo(loginPathFor(to.fullPath));
});
