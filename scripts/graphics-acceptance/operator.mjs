/**
 * The signed-in operator an acceptance run works as (#396).
 *
 * Every path in `routes.mjs` except the Screen Output surface sits behind
 * ADR-0010's deny-by-default boundary, so a harness with no session gets 401
 * from the first request it makes and proves nothing. The author cookie
 * `openInstallation` already mints is a different credential entirely — it says
 * which Graphics Author owns an operation, not that anybody is allowed in.
 *
 * Two ways in, and which one a run takes is decided by what it was given rather
 * than by where it is pointed:
 *
 * - **Credentials in the environment.** An operator who has an account says so,
 *   and the harness signs in as them. This is the only way a `--deployed` run
 *   can work, since a deployed installation's bootstrap secret is deleted after
 *   the install ceremony and is not something a harness can read.
 * - **The first-admin bootstrap.** With `NUXT_ADMIN_BOOTSTRAP_TOKEN` in hand the
 *   harness ensures its **own** account — a dedicated address, never a
 *   developer's — and signs in as that. This is the ordinary local path, and
 *   `.dev.vars` is where the token comes from, which is why #396 made that name
 *   one a local run is checked for (`./local-configuration.mjs`).
 *
 * **The password is generated per run and never written down.** A literal in
 * this file would be a source-known password on an admin account, and the
 * bootstrap route's ensure semantics are create-or-reset — so the same literal
 * pointed at a real installation would arm an account anybody who can read this
 * repository could then use. Each run resets its own account's password to a
 * fresh random value it keeps in memory for the length of one sign-in.
 *
 * The decision is a pure function so it can be exercised in every state without
 * an installation in front of it; only `openOperatorSession` performs requests.
 */

import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { AcceptanceFailure } from './evidence.mjs';
import { readLocalConfigurationFiles, suppliedNames } from './local-configuration.mjs';

/** Where a run says it already has an account, and what it signs in with. */
export const OPERATOR_EMAIL_ENV = 'STREAM_KEEPR_ACCEPTANCE_OPERATOR_EMAIL';
export const OPERATOR_PASSWORD_ENV = 'STREAM_KEEPR_ACCEPTANCE_OPERATOR_PASSWORD';

/** The armed secret the first-admin bootstrap answers to, as the operator sets it. */
export const BOOTSTRAP_TOKEN_NAME = 'NUXT_ADMIN_BOOTSTRAP_TOKEN';

/**
 * The account a bootstrapping run owns.
 *
 * Its own address rather than a developer's, because ensure is create-or-reset:
 * a shared address would mean every acceptance run silently changed the password
 * of the account its operator signs in with by hand.
 */
export const HARNESS_OPERATOR_EMAIL = 'graphics-acceptance@keepr.digital';

const SIGN_IN_ROUTE = '/api/auth/sign-in/email';
const BOOTSTRAP_ROUTE = '/api/bootstrap/ensure-admin';
const BOOTSTRAP_TOKEN_HEADER = 'x-admin-bootstrap-token';

/** A value the environment can actually supply, or undefined. */
function usable(value) {
	return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * How this run intends to become somebody, or a named failure if it cannot.
 *
 * `supplied` is what the checkout's own files could give — resolved by
 * `suppliedNames` in `./local-configuration.mjs` — and it is consulted **only**
 * for a local run. Sending a local `.dev.vars` token to a deployed origin would
 * be handing this checkout's secret to a remote host on the strength of a
 * default, which is not a mistake a harness should be able to make.
 *
 * @param {{
 *   deployed?: boolean,
 *   env?: Record<string, string | undefined>,
 *   supplied?: Record<string, string | undefined>,
 *   newPassword: string,
 * }} options
 */
export function operatorCredentialPlan({ deployed = false, env = {}, supplied = {}, newPassword }) {
	const email = usable(env[OPERATOR_EMAIL_ENV]);
	const password = usable(env[OPERATOR_PASSWORD_ENV]);
	if (email && password)
		return { kind: 'sign-in', email, password };

	const bootstrapToken = usable(env[BOOTSTRAP_TOKEN_NAME])
		?? (deployed ? undefined : usable(supplied[BOOTSTRAP_TOKEN_NAME]));
	if (bootstrapToken)
		return { kind: 'bootstrap', email: HARNESS_OPERATOR_EMAIL, password: newPassword, bootstrapToken };

	// Prose first, then the code, exactly as the local-configuration preflight
	// does it: the reader needs the two names, and the detail a formatter will
	// print cannot carry a secret or a long value.
	process.stderr.write(`${operatorUnavailableNotice({ deployed })}\n`);
	throw new AcceptanceFailure('harness-operator-unavailable', {
		mode: deployed ? 'deployed' : 'local',
	});
}

/**
 * What to set, and why this run stopped before it opened anything.
 *
 * Split by mode because the two readers are in different positions. A local run
 * is almost always a checkout missing its gitignored files, and the fix is the
 * copy step every other notice here points at. A deployed run has no such file
 * to copy and never reads one, so telling its reader about `.dev.vars` would
 * send them after something that could not have helped.
 *
 * @param {{ deployed?: boolean }} options
 */
export function operatorUnavailableNotice({ deployed = false } = {}) {
	const credentials = `Set ${OPERATOR_EMAIL_ENV} and ${OPERATOR_PASSWORD_ENV} to an existing operator's `
		+ 'account to sign in as them';

	if (deployed) {
		return `This run has no operator to sign in as, and every route behind the API boundary answers 401 `
			+ `without one, so nothing would have been proved. ${credentials} — a deployed installation's `
			+ `${BOOTSTRAP_TOKEN_NAME} is deleted after the install ceremony, so there is nothing here to `
			+ `bootstrap with. Setting ${BOOTSTRAP_TOKEN_NAME} in this shell works too, if you have armed it on `
			+ `the installation for the length of the run.`;
	}

	return `This run has no operator to sign in as, and every route behind the API boundary answers 401 `
		+ `without one, so nothing would have been proved. A local run ordinarily takes ${BOOTSTRAP_TOKEN_NAME} `
		+ `from .env or .dev.vars and creates its own account through the first-admin bootstrap; a fresh git `
		+ `worktree has neither file, because both are gitignored. Fix: copy .env and .dev.vars in from the `
		+ `checkout you branched from, or fill in .env.example and .dev.vars.example. ${credentials} instead, `
		+ `if you would rather not arm the bootstrap. See docs/agents/parallel-rounds.md.`;
}

/**
 * Whether this checkout's own secrets may be presented to this origin.
 *
 * The acceptance harnesses answer that question with their `--deployed` flag,
 * which they already thread through everything. The measurement probes in
 * `scripts/` have no such flag — they take one mandatory `PROBE_ORIGIN` — so for
 * them the question really is about the host, and this is its honest form: a
 * secret out of `.env` or `.dev.vars` is for a server on this machine, and
 * anything else is somebody else's installation.
 *
 * `0.0.0.0` counts because a server bound to it and addressed by it is the local
 * one; a hostname that merely resolves to a loopback address does not, since
 * nothing here resolves names and guessing would be the wrong way round.
 *
 * @param {string} origin
 */
export function isLoopbackOrigin(origin) {
	try {
		const { hostname } = new URL(origin);
		return ['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'].includes(hostname);
	}
	catch {
		return false;
	}
}

/** A password nobody has to know, for the length of one sign-in. */
export function newOperatorPassword() {
	return randomBytes(24).toString('base64url');
}

/**
 * Every cookie a response set, as `name=value` pairs.
 *
 * All of them rather than the session token by name: Better Auth writes
 * `__Secure-`-prefixed names over https and plain ones over http, and a harness
 * that matched one spelling would work locally and refuse to sign in against a
 * deployed installation.
 *
 * Pairs rather than one folded header, because both consumers need them
 * separately: a request header joins them with `; `, and the acceptance browser
 * installs each one in its own jar entry.
 */
export function sessionCookiePairs(response) {
	return response.headers.getSetCookie()
		.map(cookie => cookie.split(';', 1)[0])
		.filter(pair => pair.includes('='));
}

/**
 * A JSON POST that says where it came from.
 *
 * **`origin` is load-bearing, and its absence is why this failed against a built
 * Worker.** Better Auth refuses a state-changing request carrying no `Origin` with
 * `403 MISSING_OR_NULL_ORIGIN` — its CSRF defence, and correct: a browser always
 * sends one on a cross-document POST, so a request without one is not a browser and
 * should not be taken for a session-issuing one on trust. `fetch` in Node sends
 * none, so this harness has to say so itself, truthfully — it *is* the client at
 * this origin.
 *
 * Found by running the fan-out probe against `pnpm preview` rather than by reading:
 * the integration suite signs in happily because `nuxt dev` does not enforce this,
 * so nothing on the dev server would ever have caught it and every `--deployed`
 * acceptance run would have stopped at `harness-operator-unavailable` with a 403.
 *
 * @param {string} origin The installation, as the `Origin` a browser would send.
 */
async function postJson(origin, path, body, headers = {}) {
	return await fetch(`${origin}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin, ...headers },
		body: JSON.stringify(body),
		redirect: 'manual',
	});
}

/**
 * Sign in, arming an account first where that is this run's way in.
 *
 * Returns the session's cookie pairs, which every later request carries. Both
 * failures are `harness-operator-unavailable` rather than an unmet precondition:
 * the installation is answering, this run simply has no identity on it, and the
 * distinction is what tells a reader to look at their environment rather than at
 * their server.
 *
 * @param {string} origin
 * @param {{ deployed?: boolean, env?: Record<string, string | undefined>, supplied?: Record<string, string | undefined> }} options
 */
export async function openOperatorSession(origin, { deployed = false, env = process.env, supplied = {} } = {}) {
	const plan = operatorCredentialPlan({ deployed, env, supplied, newPassword: newOperatorPassword() });

	if (plan.kind === 'bootstrap') {
		const armed = await postJson(
			origin,
			BOOTSTRAP_ROUTE,
			{ email: plan.email, password: plan.password, name: 'Graphics acceptance harness' },
			{ [BOOTSTRAP_TOKEN_HEADER]: plan.bootstrapToken },
		);
		if (!armed.ok) {
			throw new AcceptanceFailure('harness-operator-unavailable', {
				step: 'bootstrap',
				actual: armed.status,
			});
		}
	}

	const signIn = await postJson(origin, SIGN_IN_ROUTE, { email: plan.email, password: plan.password });
	if (!signIn.ok) {
		throw new AcceptanceFailure('harness-operator-unavailable', {
			step: 'sign-in',
			actual: signIn.status,
		});
	}

	const cookies = sessionCookiePairs(signIn);
	if (cookies.length === 0) {
		throw new AcceptanceFailure('harness-operator-unavailable', {
			step: 'sign-in',
			reason: 'no session cookie',
		});
	}

	return cookies;
}

/**
 * Sign in against one origin, deciding from the origin alone what this checkout
 * may present to it.
 *
 * For the callers that have no `--deployed` flag: the measurement probes take a
 * single mandatory origin, and both of them were writing out the same three lines
 * — resolve loopback, invert it into `deployed`, read local files only when local.
 * Two copies of a rule about where a secret may travel is one copy too many.
 *
 * The acceptance harnesses keep passing `deployed` explicitly, because they have
 * it: a run's mode is a stated choice there, not something to infer from a
 * hostname.
 *
 * @param {string} origin
 */
export async function openOperatorSessionForOrigin(origin) {
	const local = isLoopbackOrigin(origin);
	return await openOperatorSession(origin, {
		deployed: !local,
		supplied: local ? suppliedNames(readLocalConfigurationFiles()) : {},
	});
}
