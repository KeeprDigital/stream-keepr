/**
 * What a local checkout has to be given before the surfaces that read it stop
 * refusing, and the one line a dev server says when it has not been.
 *
 * `.env` is the whole of local configuration since #412. Nuxt loads it into
 * `process.env` before a module's `setup` runs, so `nuxt dev` has these names in
 * hand by the time runtimeConfig is read, and `pnpm preview` stages the same file
 * next to the generated wrangler config, where a previewed Worker reads it
 * (`scripts/stage-preview-secrets.mjs`).
 *
 * There were two files, and a `.dev.vars` whose `NUXT_`-prefixed names the Nuxt
 * module in front of this one copied into `process.env` for the dev server. The
 * reason recorded for the second file — that wrangler would not read `.env` —
 * was measured false: wrangler reads one of the two and prefers the other one, so
 * the three names living only in `.env` reached a previewed Worker through nothing
 * at all. Collapsing to one file closed that gap and took the copying with it
 * (#412).
 *
 * The names, their surfaces and the notice live here, apart from the Nuxt module
 * that prints it, so all of it can be exercised without booting Nuxt — and so the
 * `.mjs` acceptance harnesses can import the one list rather than restate it
 * (`scripts/graphics-acceptance/local-configuration.mjs`).
 */

import {
	LOCAL_DEVELOPER_USER_NAME,
	localAuthBypassEnabled,
} from '../shared/utils/localDeveloperAuth.ts';

const NAME = /^[A-Z_]\w*$/i;
const EXPORT_PREFIX = /^export\s+/;

/**
 * The `NUXT_` names an ordinary local checkout has to be given before the surfaces
 * that read them stop refusing, and the whole of what the #130 notice is asserting.
 * `missingLocalNuxtNames` removes the two account-setup names when the exact
 * development bypass is active; the canonical list remains complete for preview
 * and acceptance harnesses, where the bypass is deliberately inert.
 *
 * These are `.env.example`'s assignments minus everything in
 * `LOCALLY_OPTIONAL_NUXT_NAMES` below, which carries its own reasons per name.
 * `localConfiguration.test.ts` pins the partition against the example file, so a new
 * name added there fails until someone decides which side it belongs on.
 *
 * The subtraction was written as "minus `NUXT_ABLY_API_KEY`" when that was the
 * only exception, and was correct when written — three assignments, one of them
 * the Ably key. #393's auth secret falsified it and #394's bootstrap token
 * compounded it, neither noticing that the sentence enumerated a list it was
 * adding to. Stated as a reference to the list rather than a transcription of
 * it, so the next name cannot falsify it again.
 *
 * The example file it is pinned against changed on #412, and with it the size of
 * what this partition has to account for: `.dev.vars.example` assigned five names,
 * `.env.example` assigns eight. The three it gains are the Melee ones, and they are
 * optional — see below.
 *
 * The last two arrived here on #396, which is the ticket the comment on
 * `LOCALLY_OPTIONAL_NUXT_NAMES` used to promise them to. Before it, a checkout
 * needed neither: there was no boundary and no login page, so a notice naming a
 * surface a developer could not reach yet would have been the cell-H false
 * notice #130's own verification caught. With `/api/**` denying by default, a
 * checkout without them cannot sign in to anything — which is the moment the
 * notice becomes both true and useful.
 */
export const LOCALLY_REQUIRED_NUXT_NAMES = [
	'NUXT_GRAPHICS_ADMIN_TOKEN',
	'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY',
	'NUXT_BETTER_AUTH_SECRET',
	'NUXT_ADMIN_BOOTSTRAP_TOKEN',
] as const;

export type LocallyRequiredNuxtName = typeof LOCALLY_REQUIRED_NUXT_NAMES[number];

/**
 * Deliberately optional, and named here so the partition above is legible.
 *
 * The Ably key is the only one here that reaches a third party. An empty one is
 * the expected state of a checkout that never claimed to have realtime, and #223
 * already owns saying so: the integration suite skips the two tests that reach the
 * service and announces the reason once. Requiring it would warn every such
 * checkout about a secret it does not need.
 *
 * The three Melee names are optional in a different key: nothing refuses at boot
 * without them, so a notice naming them would be telling a developer to go and find
 * a secret they do not need yet. They are in this list at all only as of #412 —
 * before it the partition was pinned against `.dev.vars.example`, which never
 * assigned them, and their absence from that file was also why a previewed Worker
 * could not read a Melee credential however full the root `.env` was. One file
 * closed both: the partition now covers every name a developer is handed, and the
 * file staged for the preview is the file that carries them.
 *
 * The two auth names that sat here from #393 and #394 moved to required on #396
 * — see the note above. The promise that they would was recorded in this
 * docblock *and* on the ticket that inherits it, because a promise living only
 * in the code of the thing being deferred is one the deferring ticket can keep
 * and the inheriting ticket never sees.
 */
export const LOCALLY_OPTIONAL_NUXT_NAMES = [
	'NUXT_ABLY_API_KEY',
	'NUXT_LOCAL_AUTH_BYPASS',
	'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY',
	'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION',
	'NUXT_MELEE_CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS',
] as const;

/**
 * What stops working per name, in the words its own refusal uses.
 *
 * One entry per required name, so the notice can name the surfaces belonging to the
 * names that are *actually* missing. Naming all of them unconditionally is the cell-H
 * defect #130's verification found: a checkout that filled in
 * `NUXT_GRAPHICS_ADMIN_TOKEN` and not the signing key — the ordinary result of
 * working through `.env.example` one name at a time, since the signing key needs an
 * `openssl` command — was told Graphics Administrator operations answer 503 when they
 * demonstrably do not. `requireGraphicsAdministrator` refuses only on an empty token
 * and otherwise falls through to its 403 branch.
 *
 * The strings are the refusals' own, so a reader can match notice to response:
 * "…so Graphics Administrator operations are unavailable" and "…so Screen Output asset
 * capabilities are unavailable". Both now begin with the environment name itself, because
 * #321 gave the first one a `ServiceConfigurationError` — before that it read "Graphics
 * Administrator access is not configured" and reached the client as 'Internal Server
 * Error', so the notice quoted a sentence nobody could see. `satisfies` makes a new
 * required name a type error here rather than a name whose surface the notice silently
 * omits.
 *
 * The two auth entries are #396's, and they are quoted from the same two places: the
 * bootstrap token's clause is `requireAdminBootstrapToken`'s
 * (`server/modules/admin-bootstrap`), and the secret's is `serverAuth`'s
 * (`server/utils/auth.ts`) — reworded on that ticket, because "is not configured" named
 * no surface at all and there was none to name until the boundary existed. The secret's
 * surface is the widest of the four by a distance: with a boundary over `/api/**`, a blank
 * secret is every authenticated route answering 503 as well as sign-in itself, and a notice
 * that said only "signing in" would leave a developer to discover the rest one route at a
 * time.
 */
export const LOCAL_NUXT_NAME_SURFACES = {
	NUXT_GRAPHICS_ADMIN_TOKEN: 'Graphics Administrator operations',
	NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY: 'Screen Output asset capabilities',
	NUXT_BETTER_AUTH_SECRET: 'signing in and every authenticated API route',
	NUXT_ADMIN_BOOTSTRAP_TOKEN: 'first-admin bootstrap',
} as const satisfies Record<LocallyRequiredNuxtName, string>;

/**
 * Which required names the environment cannot supply.
 *
 * Blank counts as missing, because that is how the readers count it —
 * `requireGraphicsAdministrator` trims before testing, and `signingKey` rejects the
 * empty string — and because the likeliest way to hold a populated `.env` full of
 * blanks is `cp .env.example .env`, which is advice this very notice gives.
 */
export function missingLocalNuxtNames(
	env: Record<string, string | undefined>,
	options: { localAuthBypassActive?: boolean } = {},
): LocallyRequiredNuxtName[] {
	const bypassedAuthNames = options.localAuthBypassActive
		? new Set<LocallyRequiredNuxtName>(['NUXT_BETTER_AUTH_SECRET', 'NUXT_ADMIN_BOOTSTRAP_TOKEN'])
		: new Set<LocallyRequiredNuxtName>();

	return LOCALLY_REQUIRED_NUXT_NAMES.filter(name =>
		!bypassedAuthNames.has(name) && (env[name] ?? '').trim().length === 0,
	);
}

/**
 * A list of names or surfaces, as a sentence rather than as a join.
 *
 * `join(' and ')` was right while two was the most this could ever be, and #396 made it
 * four: "Graphics Administrator operations and Screen Output asset capabilities and
 * signing in and every authenticated API route and first-admin bootstrap" is not a list
 * a reader can parse, and the reason is that one of the surfaces contains an `and` of
 * its own. The serial comma is what separates the items from the conjunction inside one
 * of them, so it is load-bearing here rather than a house style.
 *
 * Two items keep the plain `a and b`, which is both better English and the form every
 * existing assertion about these notices was written against.
 */
export function sentenceList(items: readonly string[], conjunction: 'and' | 'or'): string {
	if (items.length <= 2)
		return items.join(` ${conjunction} `);

	return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
}

/**
 * #130: what a dev server without local configuration is about to do, said before it
 * does it.
 *
 * `.env` is gitignored, so a fresh `git worktree` does not inherit it from the
 * checkout it was branched from. The integration suite has its own answer to that —
 * #223's skip notice for the one secret it cannot invent — but a plain `pnpm dev` in
 * the same worktree had none, and the shape of what goes wrong is the reason this
 * file exists: the names keep their empty defaults, and the surfaces that need them
 * answer 503 individually. `requireGraphicsAdministrator` says "not configured";
 * `screen-output-assets/runtime.ts` names the variable. None of them says the
 * checkout has no local configuration, which is the one fact that turns four
 * unrelated-looking 503s into one copy step.
 *
 * **Keyed on the names, not on the file**, which is the correction #130's review
 * forced. The first version of this notice fired on a missing `.dev.vars` alone —
 * but Nuxt loads `.env` into `process.env` before a module's `setup` runs, so a
 * checkout with a populated `.env` and no second file was perfectly well configured,
 * and was exactly what a reader of #130's own `.env`-centric text would build. That
 * version told those developers their working installation answered 503. A notice
 * that can be false where it fires is worse than no notice: it is the obscure
 * failure this replaced, wearing a confident face. Keyed on the names it survived
 * #412 deleting the file the other version was about, unchanged in behaviour.
 *
 * A warning rather than a refusal. Plenty of this application runs without these
 * names — that is exactly what a worktree opened to read the UI wants — so failing
 * the boot would trade an obscure 503 for an obstruction.
 */
export function localConfigurationBootNotice(missing: readonly LocallyRequiredNuxtName[]): string {
	const names = missing.length === 1
		? `${missing[0]}, so it keeps its empty default`
		: `${sentenceList(missing, 'or')}, so they keep their empty default`;

	// Only the surfaces belonging to the names that are missing, and only the
	// "each says so on its own" clause when there is more than one to say it.
	const surfaces = missing.map(name => LOCAL_NUXT_NAME_SURFACES[name]);
	const consequence = surfaces.length === 1
		? `${surfaces[0]} answer 503 without naming this as the cause`
		: `${sentenceList(surfaces, 'and')} answer 503, and each says so on its own without naming a common cause`;

	return `Nothing in this checkout sets ${names}: ${consequence}. `
		+ 'A fresh git worktree is the usual way to arrive here — .env is gitignored, so a new checkout '
		+ 'inherits none of it from the one it was branched from, and a copied .env.example carries the names '
		+ 'with empty values. Fix: copy .env in from the checkout you branched from, or fill in .env.example. '
		+ 'See docs/agents/parallel-rounds.md.';
}

/**
 * Whether this process should say anything about local configuration at all.
 *
 * Two silences, both structural rather than incidental.
 *
 * A build must not: there these names come from real secrets rather than from a
 * checkout, and advice about copying a local file into place is advice a build has
 * no way to act on and no business acting on.
 *
 * The integration suite must not, even though it runs `nuxt dev`. It pins the names
 * it needs into the environment of the *server child* it spawns, not into its own,
 * so its own process is short of every one of them by design and a notice keyed on
 * what this process can supply would fire on every run of a suite behaving exactly
 * as intended. The suite already announces itself to `nuxt.config.ts`; this reads
 * the same announcement.
 *
 * Until #412 this second refusal did a heavier job: it kept a developer's
 * `.dev.vars` out of the parent process, where the spawned server would inherit
 * every `NUXT_` name the suite had not thought to pin — isolation by coincidence,
 * which is the shape #197 and #222 were about. Nothing is adopted any more, and
 * Nuxt's own `.env` loading was never this module's to control, so what is left is
 * the noise argument alone. It is enough on its own.
 *
 * `=== 'true'` rather than "is set", because that is what `STREAM_KEEPR_INTEGRATION`
 * means everywhere else it is read (`nuxt.config.ts`, `server/plugins/error-handler.ts`)
 * and the suite sets exactly that. A second, looser definition of "this is the
 * integration suite" would be its own quiet bug.
 */
export function announcesLocalConfiguration(context: {
	dev: boolean;
	env: Record<string, string | undefined>;
}): boolean {
	return context.dev && context.env.STREAM_KEEPR_INTEGRATION !== 'true';
}

/** Reads a dotenv body — `.env`, or the copy of it staged for a previewed Worker. */
export function parseDotenv(source: string): Map<string, string> {
	const values = new Map<string, string>();
	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith('#'))
			continue;
		const separator = line.indexOf('=');
		if (separator <= 0)
			continue;
		const name = line.slice(0, separator).replace(EXPORT_PREFIX, '').trim();
		if (!NAME.test(name))
			continue;
		values.set(name, unquote(line.slice(separator + 1).trim()));
	}
	return values;
}

function unquote(value: string): string {
	const quote = value[0];
	if ((quote === '"' || quote === '\'') && value.length >= 2 && value.endsWith(quote))
		return value.slice(1, -1);
	// An unquoted value ends at an inline comment, as dotenv reads it.
	return value.replace(/\s+#.*$/, '');
}

/**
 * The one line this run should log, or nothing.
 *
 * Here rather than in the Nuxt module because the module is meant to be an adapter
 * with nothing left to get wrong, and #130's first version put a three-way
 * conditional in it that no suite could reach — a surviving mutation there
 * reintroduced the warn-the-integration-suite defect this gate exists to prevent. A
 * pure function of the environment can be pinned; four lines inside
 * `defineNuxtModule` cannot.
 *
 * The silence is checked first and separately from what is missing. A build and the
 * integration suite are both short of these names in their own process — the suite
 * pins them into the *server child's* environment, not its own — so gating on
 * `missing` alone would warn them on every run.
 */
export function localConfigurationLogLine(context: {
	dev: boolean;
	env: Record<string, string | undefined>;
}): { level: 'warn'; message: string } | undefined {
	if (!announcesLocalConfiguration(context))
		return undefined;

	const missing = missingLocalNuxtNames(context.env, {
		localAuthBypassActive: localAuthBypassEnabled({
			dev: context.dev,
			value: context.env.NUXT_LOCAL_AUTH_BYPASS,
		}),
	});
	if (missing.length === 0)
		return undefined;

	return { level: 'warn', message: localConfigurationBootNotice(missing) };
}

/** The warning an intentionally unauthenticated development server emits. */
export function localAuthBypassLogLine(context: {
	dev: boolean;
	env: Record<string, string | undefined>;
}): { level: 'warn'; message: string } | undefined {
	if (!announcesLocalConfiguration(context)
		|| !localAuthBypassEnabled({ dev: context.dev, value: context.env.NUXT_LOCAL_AUTH_BYPASS })) {
		return undefined;
	}

	return {
		level: 'warn',
		message: `AUTHENTICATION BYPASSED: every request is acting as ${LOCAL_DEVELOPER_USER_NAME}. `
			+ 'Keep the development server bound to loopback; binding it to 0.0.0.0 or another non-loopback '
			+ 'address exposes the application to other machines without authentication.',
	};
}
