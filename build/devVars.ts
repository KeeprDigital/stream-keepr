/**
 * Wrangler reads worker secrets from `.dev.vars`; Nuxt reads runtimeConfig
 * overrides from `.env`. The two files hold the same names for the same
 * meanings, but only the deployed and previewed Worker ever sees both: `nuxt
 * dev` runs Nitro in Node with the Cloudflare bindings proxied in, so a value
 * that lives only in `.dev.vars` reaches the bindings and never reaches
 * `process.env`, where `NUXT_`-prefixed overrides are read from.
 *
 * Parsing and adoption live here, apart from the Nuxt module that calls them,
 * so both can be exercised without booting Nuxt.
 */

const NAME = /^[A-Z_]\w*$/i;
const EXPORT_PREFIX = /^export\s+/;

/**
 * The `NUXT_` names a local checkout has to be given before the surfaces that read
 * them stop refusing, and the whole of what the #130 notice is asserting.
 *
 * These are `.dev.vars.example`'s assignments minus `NUXT_ABLY_API_KEY`, which is
 * deliberately not here: it reaches a third party, an empty one is the *expected*
 * state of a checkout that never claimed to have realtime, and #223 already owns
 * saying so. `devVars.test.ts` pins the partition against the example file, so a
 * fourth name added there fails until someone decides which side it belongs on.
 *
 * The Melee names in `.env.example` are absent for the same reason in a different
 * key: nothing refuses without them at boot, so a notice naming them would be
 * telling a developer to go and find a secret they do not need yet.
 */
export const LOCALLY_REQUIRED_NUXT_NAMES = [
	'NUXT_GRAPHICS_ADMIN_TOKEN',
	'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY',
] as const;

export type LocallyRequiredNuxtName = typeof LOCALLY_REQUIRED_NUXT_NAMES[number];

/**
 * Deliberately optional, and named here so the partition above is legible.
 *
 * `NUXT_BETTER_AUTH_SECRET` sits here for now because #393 mounts the auth
 * foundation and nothing yet demands a session: a checkout without the secret
 * loses only the `/api/auth/**` routes, which answer by naming the setting
 * (`serverAuth`), while every present surface works. The ticket that puts a
 * boundary in front of real routes is the one that moves it to required.
 */
export const LOCALLY_OPTIONAL_NUXT_NAMES = ['NUXT_ABLY_API_KEY', 'NUXT_BETTER_AUTH_SECRET'] as const;

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
 */
export const LOCAL_NUXT_NAME_SURFACES = {
	NUXT_GRAPHICS_ADMIN_TOKEN: 'Graphics Administrator operations',
	NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY: 'Screen Output asset capabilities',
} as const satisfies Record<LocallyRequiredNuxtName, string>;

/**
 * Which required names the environment cannot supply, after adoption has had its go.
 *
 * Blank counts as missing, because that is how the readers count it —
 * `requireGraphicsAdministrator` trims before testing, and `signingKey` rejects the
 * empty string — and because the likeliest way to hold a populated `.env` full of
 * blanks is `cp .env.example .env`, which is advice this very notice gives.
 */
export function missingLocalNuxtNames(env: Record<string, string | undefined>): LocallyRequiredNuxtName[] {
	return LOCALLY_REQUIRED_NUXT_NAMES.filter(name => (env[name] ?? '').trim().length === 0);
}

/**
 * #130: what a dev server without local configuration is about to do, said before it
 * does it.
 *
 * `.env` and `.dev.vars` are both gitignored, so a fresh `git worktree` inherits
 * neither from the checkout it was branched from. The integration suite has its own
 * answer to that — #223's skip notice for the one secret it cannot invent — but a
 * plain `pnpm dev` in the same worktree had none, and the shape of what goes wrong is
 * the reason this file exists: the names keep their empty defaults, and the two
 * surfaces that need them answer 503 individually. `requireGraphicsAdministrator`
 * says "not configured"; `screen-output-assets/runtime.ts` names the variable.
 * Neither says the checkout has no local configuration, which is the one fact that
 * turns two unrelated-looking 503s into one copy step.
 *
 * **Keyed on the names, not on the file**, which is the correction #130's review
 * forced. Nuxt loads `.env` into `process.env` before a module's `setup` runs — that
 * is why `adoptDevVars` never overwrites what it finds — so a checkout with a
 * populated `.env` and no `.dev.vars` is perfectly well configured, and is exactly
 * what a reader of #130's own `.env`-centric text would build. The first version of
 * this notice fired on the missing file alone and told that developer their working
 * installation answered 503. A notice that can be false where it fires is worse than
 * no notice: it is the obscure failure this replaced, wearing a confident face.
 *
 * A warning rather than a refusal. Plenty of this application runs without these
 * names — that is exactly what a worktree opened to read the UI wants — so failing
 * the boot would trade an obscure 503 for an obstruction.
 */
export function devVarsAbsentNotice(missing: readonly LocallyRequiredNuxtName[]): string {
	const names = missing.length === 1
		? `${missing[0]}, so it keeps its empty default`
		: `${missing.join(' or ')}, so they keep their empty default`;

	// Only the surfaces belonging to the names that are missing, and only the
	// "each says so on its own" clause when there is more than one to say it.
	const surfaces = missing.map(name => LOCAL_NUXT_NAME_SURFACES[name]);
	const consequence = surfaces.length === 1
		? `${surfaces[0]} answer 503 without naming this as the cause`
		: `${surfaces.join(' and ')} answer 503, and each says so on its own without naming a common cause`;

	return `Nothing in this checkout sets ${names}: ${consequence}. `
		+ 'A fresh git worktree is the usual way to arrive here — .env and .dev.vars are both gitignored, so a new '
		+ 'checkout inherits neither from the one it was branched from, and a copied .env.example carries the names '
		+ 'with empty values. Fix: copy .env and .dev.vars in from the checkout you branched from, or fill in '
		+ '.env.example and .dev.vars.example. See docs/agents/parallel-rounds.md.';
}

/**
 * Whether this process should adopt `.dev.vars` at all.
 *
 * Two refusals, both structural rather than incidental.
 *
 * A build must not: there these names come from real secrets, and reading a
 * local file would bake a developer's key into the worker output.
 *
 * The integration suite must not, even though it runs `nuxt dev`. It pins the
 * environment it needs in `integrationSetupOptions.env` and spawns its server
 * with those two names overriding whatever it inherits — but only those two.
 * Every *other* `NUXT_` name in whatever `.dev.vars` the developer happens to
 * have would be adopted here and inherited by that server with nothing
 * overriding it, which is isolation by the coincidence of which names the suite
 * thought to pin. That is the shape #197 and #222 were about. The suite already
 * announces itself to `nuxt.config.ts`; this reads the same announcement.
 *
 * `=== 'true'` rather than "is set", because that is what `STREAM_KEEPR_INTEGRATION`
 * means everywhere else it is read (`nuxt.config.ts`, `server/plugins/error-handler.ts`)
 * and the suite sets exactly that. A second, looser definition of "this is the
 * integration suite" would be its own quiet bug.
 */
export function adoptsDevVars(context: {
	dev: boolean;
	env: Record<string, string | undefined>;
}): boolean {
	return context.dev && context.env.STREAM_KEEPR_INTEGRATION !== 'true';
}

/** Reads a `.dev.vars` body in the dotenv shape Wrangler accepts. */
export function parseDevVars(source: string): Map<string, string> {
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

export interface DevVarAdoption {
	/** Names copied into the environment because nothing had set them. */
	adopted: string[];
	/** Names left alone because the environment already carried a value. */
	retained: string[];
}

/**
 * Copies the `NUXT_`-prefixed entries of a `.dev.vars` body into `env`.
 *
 * Only the `NUXT_` prefix, because those are exactly the names runtimeConfig
 * reads; everything else in that file is a Worker's own binding and has no
 * business in a Node process. Never over an existing value, so `.env` and the
 * shell keep the last word, and never an empty one, because `.dev.vars.example`
 * ships its names with empty values and adopting those would replace a
 * runtimeConfig default with a blank string.
 */
export function adoptDevVars(source: string, env: Record<string, string | undefined>): DevVarAdoption {
	const adopted: string[] = [];
	const retained: string[] = [];
	for (const [name, value] of parseDevVars(source)) {
		if (!name.startsWith('NUXT_') || value.length === 0)
			continue;
		if (typeof env[name] === 'string' && env[name].length > 0) {
			retained.push(name);
			continue;
		}
		env[name] = value;
		adopted.push(name);
	}
	return { adopted, retained };
}

export interface DevVarsSource {
	dev: boolean;
	env: Record<string, string | undefined>;
	/** The `.dev.vars` body, or null where there is none to read. */
	read: () => string | null;
}

/**
 * Which of the three things happened, because `adopted: []` is all three at once.
 *
 * A build and the integration suite adopt nothing on purpose and must stay silent;
 * a dev server that found no file is the case #130 exists to announce. Returning the
 * distinction is what keeps the notice out of the two runs that are behaving
 * correctly — a caller reading only `adopted.length === 0` would warn the integration
 * suite, on every run, about a file it deliberately refused to open.
 */
export type DevVarsOutcome = 'refused' | 'absent' | 'read';

export interface DevVarsDecision extends DevVarAdoption {
	outcome: DevVarsOutcome;
	/**
	 * Required names the environment still cannot supply once adoption is done.
	 *
	 * A fact about the environment rather than about the file, so it is populated
	 * even for a refusal — what a refusal decides is whether anyone may *say* it.
	 */
	missing: LocallyRequiredNuxtName[];
}

/**
 * The whole decision — whether to read `.dev.vars` at all, and what to take from
 * it — so the Nuxt module around it is an adapter with nothing left to get
 * wrong. A refusal never calls `read`: not opening the file is the point of the
 * refusal, and passing `read` in is what lets a caller prove it was not opened.
 */
export function adoptDevVarsInto(source: DevVarsSource): DevVarsDecision {
	if (!adoptsDevVars(source))
		return { adopted: [], retained: [], outcome: 'refused', missing: missingLocalNuxtNames(source.env) };

	const body = source.read();
	if (body === null)
		return { adopted: [], retained: [], outcome: 'absent', missing: missingLocalNuxtNames(source.env) };

	// After adoption, so the names this run just supplied do not read as missing.
	const adoption = adoptDevVars(body, source.env);
	return { ...adoption, outcome: 'read', missing: missingLocalNuxtNames(source.env) };
}

/**
 * The one line this run should log, or nothing.
 *
 * Here rather than in the Nuxt module because the module is meant to be an adapter
 * with nothing left to get wrong, and #130's first version put a three-way
 * conditional in it that no suite could reach — a surviving mutation there
 * reintroduced the warn-the-integration-suite defect the outcome discriminator
 * exists to prevent. A pure function of the decision can be pinned; four lines
 * inside `defineNuxtModule` cannot.
 *
 * The refusal is checked first and separately from `missing`. A build and the
 * integration suite are both short of these names in their own process — the suite
 * pins them into the *server child's* environment, not its own — so gating on
 * `missing` alone would warn them on every run about a file they declined to open.
 */
export function devVarsLogLine(decision: DevVarsDecision): { level: 'warn' | 'info'; message: string } | undefined {
	if (decision.outcome === 'refused')
		return undefined;

	if (decision.missing.length > 0)
		return { level: 'warn', message: devVarsAbsentNotice(decision.missing) };

	if (decision.adopted.length > 0)
		return { level: 'info', message: `Using ${decision.adopted.join(', ')} from .dev.vars` };

	return undefined;
}
