import type { H3Event } from 'h3';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db, schema } from 'hub:db';
import { authStaticOptions } from './authOptions';
import { ServiceConfigurationError } from './errors';

/** The environment name behind `runtimeConfig.betterAuthSecret`, as the operator sets it. */
const BETTER_AUTH_SECRET_SETTING = 'NUXT_BETTER_AUTH_SECRET';

/**
 * What is unavailable without the secret, completing "<name> is not configured, so …".
 *
 * `build/devVars.ts` quotes this surface verbatim in the notice a dev server prints when
 * the name is missing, the way it quotes `requireGraphicsAdministrator`'s clause — which
 * is why the wording lives here, beside the refusal, rather than being invented there.
 *
 * It said only "is not configured" until #396. That was accurate and useless: this is the
 * instance every `/api/**` request now resolves a session through
 * (`server/middleware/api-session.ts`), so a blank secret is the whole authenticated
 * surface answering 503, not just the sign-in form. A clause naming only sign-in would
 * leave a developer to find the rest one route at a time.
 */
const BETTER_AUTH_SECRET_UNAVAILABLE_CLAUSE
	= 'is not configured, so signing in and every authenticated API route are unavailable';

/**
 * This installation's Better Auth instance, as a type.
 *
 * Named so a caller can be handed a *different* instance of the same shape —
 * `betterAuthBootstrapPort` takes one, which is what lets the unit suite build
 * the first-admin bootstrap over a throwaway auth with no database behind it.
 */
export type ServerAuth = ReturnType<typeof createAuth>;

let auth: ServerAuth | null = null;

function createAuth(secret: string) {
	return betterAuth({
		...authStaticOptions,
		// Sessions live in D1 through the Drizzle adapter — deliberately not KV
		// `secondaryStorage` (ADR decided on #386): native sliding expiry with no
		// KV single-key write cap to protect.
		database: drizzleAdapter(db, {
			provider: 'sqlite',
			schema,
		}),
		secret,
	});
}

/**
 * The Better Auth instance, constructed on first use because the secret only
 * exists at runtime. A missing secret is an unfinished deployment, and the
 * classification is what lets the response name the setting instead of a
 * stack-free 500 — same reasoning as `getAblyClient`.
 *
 * **Blank means whitespace as well as empty**, which it did not until #396. The
 * `.env`-and-`.dev.vars` notice in `build/devVars.ts` counts a name as missing
 * when it trims to nothing, and says it does so "because that is how the readers
 * count it" — true of `requireGraphicsAdministrator` and of the capability
 * signing key, and false here while this test was `!config.betterAuthSecret`. A
 * name set to a space is the likeliest way to hold one at all (`cp
 * .env.example .env` and a stray keystroke), and the old reading answered it by
 * signing every session in the installation with that space instead of naming
 * the setting. Made to matter by this ticket, which is where the name became one
 * a checkout is required to have.
 *
 * The configured value is passed on **as written**, not trimmed: what a blank
 * test decides is whether the surface is armed, and quietly signing with a
 * different string than the operator set is not this function's business.
 */
export function serverAuth() {
	if (!auth) {
		const config = useRuntimeConfig();

		if (!config.betterAuthSecret?.trim()) {
			throw new ServiceConfigurationError(BETTER_AUTH_SECRET_SETTING, BETTER_AUTH_SECRET_UNAVAILABLE_CLAUSE);
		}

		auth = createAuth(config.betterAuthSecret);
	}

	return auth;
}

/**
 * The session this request carries, or `null` — for the routes that answer to
 * more than one credential (#397).
 *
 * `server/middleware/api-session.ts` is the only caller that *requires* a
 * session, and the routes ADR-0010 exempts from it are exempt precisely because
 * something else may vouch for them: a Screen Output presents a Screen Output
 * Asset Capability and has no session at all. Those routes need to ask rather
 * than demand, and they need the answer to be a value instead of a refusal.
 *
 * **A missing `NUXT_BETTER_AUTH_SECRET` answers `null` rather than raising**,
 * which is the one judgement in here. Everywhere else that 503 is the right
 * answer — it names the setting to an operator who can go and set it. Here it
 * would take the credential-free surface down with the configuration fault: an
 * output machine showing program has no session to lose, and refusing it because
 * somebody else's* sign-in is unconfigured would be the boundary reaching past
 * what it protects. On such a checkout an operator cannot sign in to anything
 * anyway, every other route says so with the name, and `pnpm dev` warned at boot;
 * so nothing is hidden by this that is not already being said loudly.
 */
export async function optionalUserSession(event: H3Event) {
	try {
		return await serverAuth().api.getSession({ headers: event.headers });
	}
	catch (failure) {
		if (failure instanceof ServiceConfigurationError)
			return null;
		throw failure;
	}
}
