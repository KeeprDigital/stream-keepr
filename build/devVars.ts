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
 * #130: what a dev server with no `.dev.vars` is about to do, said before it does it.
 *
 * `.env` and `.dev.vars` are both gitignored, so a fresh `git worktree` inherits
 * neither from the checkout it was branched from. The integration suite has its own
 * answer to that — #223's skip notice for the one secret it cannot invent — but a
 * plain `pnpm dev` in the same worktree had none, and the shape of what goes wrong is
 * the reason this file exists: every runtimeConfig name keeps its empty default, and
 * the surfaces that need one answer 503 individually. `requireGraphicsAdministrator`
 * says "not configured"; `screen-output-assets/runtime.ts` names the variable. Neither
 * says the checkout has no local configuration *at all*, which is the one fact that
 * turns four unrelated-looking 503s into one copy step.
 *
 * A warning rather than a refusal. Plenty of this application runs without any of
 * these names — that is exactly what a worktree opened to read the UI wants — so
 * failing the boot would trade an obscure 503 for an obstruction.
 */
export const DEV_VARS_ABSENT_NOTICE
	= 'No .dev.vars in this checkout, so every NUXT_ runtimeConfig name keeps its empty default: '
		+ 'Graphics Administrator operations and Screen Output asset capabilities answer 503, and each says so '
		+ 'on its own without naming a common cause. A fresh git worktree is the usual way to arrive here — '
		+ '.env and .dev.vars are both gitignored, so a new checkout inherits neither from the one it was '
		+ 'branched from. Fix: copy .env and .dev.vars in from that checkout, or start from .env.example and '
		+ '.dev.vars.example. See docs/agents/parallel-rounds.md.';

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
}

/**
 * The whole decision — whether to read `.dev.vars` at all, and what to take from
 * it — so the Nuxt module around it is an adapter with nothing left to get
 * wrong. A refusal never calls `read`: not opening the file is the point of the
 * refusal, and passing `read` in is what lets a caller prove it was not opened.
 */
export function adoptDevVarsInto(source: DevVarsSource): DevVarsDecision {
	if (!adoptsDevVars(source))
		return { adopted: [], retained: [], outcome: 'refused' };

	const body = source.read();
	if (body === null)
		return { adopted: [], retained: [], outcome: 'absent' };

	return { ...adoptDevVars(body, source.env), outcome: 'read' };
}
