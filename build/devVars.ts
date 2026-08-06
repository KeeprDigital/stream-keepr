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
