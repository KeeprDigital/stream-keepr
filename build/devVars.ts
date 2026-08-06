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
