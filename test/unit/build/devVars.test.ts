import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	adoptDevVars,
	adoptDevVarsInto,
	adoptsDevVars,
	devVarsAbsentNotice,
	devVarsLogLine,
	LOCAL_NUXT_NAME_SURFACES,
	LOCALLY_OPTIONAL_NUXT_NAMES,
	LOCALLY_REQUIRED_NUXT_NAMES,
	missingLocalNuxtNames,
	parseDevVars,
} from '~~/build/devVars';

/** A `.env`-configured environment: both required names set, no `.dev.vars` needed. */
function configuredEnv(): Record<string, string | undefined> {
	return {
		NUXT_GRAPHICS_ADMIN_TOKEN: 'from-dotenv',
		NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
	};
}

describe('which processes adopt `.dev.vars` at all', () => {
	it('adopts in an ordinary dev server, which is the whole point', () => {
		expect(adoptsDevVars({ dev: true, env: {} })).toBe(true);
	});

	it('never adopts in a build, where these names come from real secrets', () => {
		// Reading a local file here would bake a developer's key into the output.
		expect(adoptsDevVars({ dev: false, env: {} })).toBe(false);
	});

	/**
	 * The integration suite runs its own `nuxt dev`, and pins the two names it
	 * needs in `integrationSetupOptions.env`. Those two survive because the
	 * spawned server's environment overrides them — but only those two. Any other
	 * `NUXT_` name in whatever `.dev.vars` a developer happens to have would be
	 * adopted into the parent process, inherited by that server, and overridden by
	 * nothing: isolation by the coincidence of which names the suite pinned. The
	 * refusal has to be here, where the reading happens.
	 */
	it('never adopts under the integration suite, whose environment is its own', () => {
		expect(adoptsDevVars({ dev: true, env: { STREAM_KEEPR_INTEGRATION: 'true' } })).toBe(false);
	});

	it('reads that announcement exactly as the rest of the repo reads it', () => {
		// `nuxt.config.ts` and `server/plugins/error-handler.ts` both test for
		// `'true'`. A looser reading here would make a developer with the variable
		// set to anything else silently lose the fix this module exists to deliver.
		expect(adoptsDevVars({ dev: true, env: { STREAM_KEEPR_INTEGRATION: 'false' } })).toBe(true);
		expect(adoptsDevVars({ dev: true, env: { STREAM_KEEPR_INTEGRATION: '' } })).toBe(true);
	});
});

/**
 * The whole decision, not only the predicate. The Nuxt module is an adapter
 * around this and cannot be reached by the unit suite, so a refusal that lived
 * only at the module's own call site would be a refusal nothing checks.
 */
describe('the decision the Nuxt module delegates', () => {
	const BODY = 'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY=key\n';

	it('adopts what it reads in an ordinary dev server', () => {
		const env: Record<string, string | undefined> = {};

		const adoption = adoptDevVarsInto({ dev: true, env, read: () => BODY });

		expect(adoption.adopted).toEqual(['NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY']);
		expect(adoption.outcome).toBe('read');
		expect(env.NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY).toBe('key');
	});

	it('never opens the file under the integration suite', () => {
		// Not reading it is the refusal. A version that read the file and then
		// discarded what it found would still have `.dev.vars` in its hands, one
		// edit away from the leak this exists to prevent.
		const env: Record<string, string | undefined> = { STREAM_KEEPR_INTEGRATION: 'true' };
		let reads = 0;

		const adoption = adoptDevVarsInto({
			dev: true,
			env,
			read: () => {
				reads += 1;
				return BODY;
			},
		});

		expect(reads).toBe(0);
		expect(adoption).toEqual({
			adopted: [],
			retained: [],
			outcome: 'refused',
			missing: [...LOCALLY_REQUIRED_NUXT_NAMES],
		});
		expect('NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY' in env).toBe(false);
	});

	it('never opens the file in a build', () => {
		let reads = 0;

		const adoption = adoptDevVarsInto({
			dev: false,
			env: {},
			read: () => {
				reads += 1;
				return BODY;
			},
		});

		expect(reads).toBe(0);
		expect(adoption.outcome).toBe('refused');
	});

	it('is content with a project that has no `.dev.vars` at all', () => {
		const env: Record<string, string | undefined> = {};

		expect(adoptDevVarsInto({ dev: true, env, read: () => null }))
			.toEqual({ adopted: [], retained: [], outcome: 'absent', missing: [...LOCALLY_REQUIRED_NUXT_NAMES] });
	});

	it('counts what is missing after adoption, not before it', () => {
		// The names this very run supplied must not read as missing. Computing
		// `missing` before `adoptDevVars` would make every successful adoption warn.
		const env: Record<string, string | undefined> = {};

		const adoption = adoptDevVarsInto({
			dev: true,
			env,
			read: () => 'NUXT_GRAPHICS_ADMIN_TOKEN=token\nNUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY=key\n',
		});

		expect(adoption.missing).toEqual([]);
	});
});

/**
 * #130: that a checkout with no local configuration says so once, at boot.
 *
 * The trap the issue is about is a fresh `git worktree`, which inherits neither
 * `.env` nor `.dev.vars` because both are gitignored, and then fails in whatever way
 * the first surface needing a secret fails. That is unit-testable only because the
 * decision lives in `devVars` rather than in the Nuxt module — the #242 precedent —
 * so what the notice says and which runs get it are both settled here.
 */
describe('which names a local checkout has to be given', () => {
	it('counts a blank as missing, the way the readers that refuse count it', () => {
		// `requireGraphicsAdministrator` trims before testing and `signingKey` rejects
		// the empty string, so a name set to '' is not configured. It is also the
		// likeliest wrong state there is: `cp .env.example .env` produces exactly it,
		// and this notice is where that advice comes from.
		expect(missingLocalNuxtNames({ NUXT_GRAPHICS_ADMIN_TOKEN: '', NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY: '   ' }))
			.toEqual([...LOCALLY_REQUIRED_NUXT_NAMES]);
	});

	it('counts nothing as missing once both are set', () => {
		expect(missingLocalNuxtNames(configuredEnv())).toEqual([]);
	});

	it('reports only the one that is actually absent', () => {
		const env = configuredEnv();
		delete env.NUXT_GRAPHICS_ADMIN_TOKEN;

		expect(missingLocalNuxtNames(env)).toEqual(['NUXT_GRAPHICS_ADMIN_TOKEN']);
	});

	it('partitions exactly the names `.dev.vars.example` assigns', () => {
		// The honest home for "the known names". The example file is what a developer
		// copies, so a fourth name added there has to be sorted into required or
		// deliberately-optional before this passes — rather than silently becoming a
		// name the notice never mentions.
		const example = readFileSync(fileURLToPath(new URL('../../../.dev.vars.example', import.meta.url)), 'utf8');
		const assigned = [...example.matchAll(/^(NUXT_\w+)=/gm)].map(match => match[1]).sort();

		expect(assigned).toEqual([...LOCALLY_REQUIRED_NUXT_NAMES, ...LOCALLY_OPTIONAL_NUXT_NAMES].sort());
	});

	it('gives every required name a surface, in that surface\'s own words', () => {
		// `satisfies` already makes a missing entry a type error; this pins the other
		// half, that each string is the one the refusal actually uses, so a reader can
		// match the notice to the 503 they are looking at.
		expect(Object.keys(LOCAL_NUXT_NAME_SURFACES).sort()).toEqual([...LOCALLY_REQUIRED_NUXT_NAMES].sort());
		expect(LOCAL_NUXT_NAME_SURFACES.NUXT_GRAPHICS_ADMIN_TOKEN).toBe('Graphics Administrator operations');
		expect(LOCAL_NUXT_NAME_SURFACES.NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY).toBe('Screen Output asset capabilities');
	});

	it('leaves the Ably key deliberately optional, because #223 already owns it', () => {
		// An empty Ably key is the expected state of a checkout that never claimed to
		// have realtime. Requiring it here would warn every such checkout about a
		// third-party secret it does not need, which is #223's failure mode inverted.
		expect(LOCALLY_REQUIRED_NUXT_NAMES).not.toContain('NUXT_ABLY_API_KEY');
		expect(LOCALLY_OPTIONAL_NUXT_NAMES).toContain('NUXT_ABLY_API_KEY');
	});
});

/**
 * #130: that a checkout without local configuration says so once, at boot — and that
 * a checkout *with* it says nothing.
 *
 * The four cells are the whole point, and the fourth is the one #130's review found.
 * The first version keyed the notice on the missing `.dev.vars` file alone, which is
 * wrong because Nuxt loads `.env` into `process.env` before a module's `setup` runs —
 * that is precisely why `adoptDevVars` never overwrites what it finds. A developer
 * who read #130's own `.env`-centric ticket text and copied `.env` alone was then
 * told their working installation kept its empty defaults and answered 503. Both
 * clauses false, from a notice that exists to stop false readings.
 */
describe('what a dev server says about its local configuration', () => {
	/** Cell A: no file, nothing in the environment. The worktree case. */
	it('warns when neither the file nor the environment supplies the names', () => {
		const line = devVarsLogLine(adoptDevVarsInto({ dev: true, env: {}, read: () => null }));

		expect(line?.level).toBe('warn');
		expect(line?.message).toContain('NUXT_GRAPHICS_ADMIN_TOKEN');
		expect(line?.message).toContain('NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY');
	});

	/** Cell B: the file supplies them. The primary checkout. */
	it('reports the adoption, and does not warn, when the file supplies them', () => {
		const line = devVarsLogLine(adoptDevVarsInto({
			dev: true,
			env: {},
			read: () => 'NUXT_GRAPHICS_ADMIN_TOKEN=token\nNUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY=key\n',
		}));

		expect(line?.level).toBe('info');
		expect(line?.message).toBe('Using NUXT_GRAPHICS_ADMIN_TOKEN, NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY from .dev.vars');
	});

	/** Cell C: a file that exists and is empty — `cp .dev.vars.example .dev.vars`. */
	it('warns about a file that exists and supplies nothing', () => {
		// Keyed on the names, so this cell is covered for free. Keyed on the file it
		// would have been silent here, which is a real 503 with no explanation.
		const line = devVarsLogLine(adoptDevVarsInto({
			dev: true,
			env: {},
			read: () => 'NUXT_GRAPHICS_ADMIN_TOKEN=""\nNUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY=""\n',
		}));

		expect(line?.level).toBe('warn');
	});

	/**
	 * Cell D: a populated `.env` and no `.dev.vars` — the blocker #130's review found.
	 *
	 * This is what a reader of the issue's own text builds, and the installation
	 * works. Saying anything here is saying something false.
	 */
	it('says nothing when `.env` already supplied the names and there is no `.dev.vars`', () => {
		const line = devVarsLogLine(adoptDevVarsInto({ dev: true, env: configuredEnv(), read: () => null }));

		expect(line).toBeUndefined();
	});

	it('stays silent for the two runs that decline to open the file at all', () => {
		// Both are short of these names in their own process — the integration suite
		// pins them into the server child's environment, not its own — so a gate on
		// `missing` alone would warn them every run about a deliberate refusal.
		const integration = devVarsLogLine(adoptDevVarsInto({
			dev: true,
			env: { STREAM_KEEPR_INTEGRATION: 'true' },
			read: () => null,
		}));
		const build = devVarsLogLine(adoptDevVarsInto({ dev: false, env: {}, read: () => null }));

		expect(integration).toBeUndefined();
		expect(build).toBeUndefined();
	});

	/**
	 * Cell H: `.env` supplies the admin token and not the signing key.
	 *
	 * The residual #130's verification found. Naming the missing *name* correctly is
	 * not enough — the causal clause named both surfaces unconditionally, so this
	 * developer was told Graphics Administrator operations answer 503 while they
	 * demonstrably worked. It is the most ordinary way to arrive anywhere near here:
	 * filling in `.env.example` one name at a time, with the signing key left for
	 * last because it needs an `openssl` command to generate.
	 */
	it('names only the one that is missing when only one is, and only its surface', () => {
		const env = configuredEnv();
		delete env.NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY;

		const line = devVarsLogLine(adoptDevVarsInto({ dev: true, env, read: () => null }));

		expect(line?.level).toBe('warn');
		expect(line?.message).toContain('NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY');
		expect(line?.message).not.toContain('NUXT_GRAPHICS_ADMIN_TOKEN');
		expect(line?.message).toContain('Screen Output asset capabilities');
		// The mirror assertion, and the whole of cell H: the surface that still works
		// must not be named. `requireGraphicsAdministrator` refuses only on an empty
		// token and otherwise falls through to its 403 branch.
		expect(line?.message).not.toContain('Graphics Administrator');
		// Singular, because a notice that says "they keep their empty default" about
		// one name reads as though a second thing is wrong that the reader cannot find.
		expect(line?.message).toContain('it keeps its');
		// And no "each says so on its own", which needs more than one to be true.
		expect(line?.message).not.toContain('each says so');
	});

	/** Cell H's mirror, so neither surface is named unconditionally in either direction. */
	it('names only the admin surface when only the admin token is missing', () => {
		const env = configuredEnv();
		delete env.NUXT_GRAPHICS_ADMIN_TOKEN;

		const line = devVarsLogLine(adoptDevVarsInto({ dev: true, env, read: () => null }));

		expect(line?.message).toContain('Graphics Administrator operations');
		expect(line?.message).not.toContain('Screen Output asset capabilities');
	});
});

describe('the notice a missing name produces', () => {
	const notice = devVarsAbsentNotice([...LOCALLY_REQUIRED_NUXT_NAMES]);

	it('names both gitignored files, so the reader knows what to copy', () => {
		// `.env` as well as `.dev.vars`: a worktree is missing both, and a notice that
		// named only the file it happened to look for would send the reader back for
		// the other one after the next 503.
		//
		// The lookaheads are load-bearing. `toContain('.env')` is satisfied by
		// `.env.example`, so the first version of this assertion passed against a
		// notice that had stopped naming `.env` at all.
		expect(notice).toMatch(/\.env(?!\.example)/);
		expect(notice).toMatch(/\.dev\.vars(?!\.example)/);
		expect(notice).toContain('.env.example');
		expect(notice).toContain('.dev.vars.example');
	});

	it('names the cause and the fix, not just the condition', () => {
		// The state is something a reader can already see. What they cannot see is
		// that a worktree is why, and that a copy closes it.
		expect(notice).toContain('git worktree');
		expect(notice).toContain('gitignored');
		expect(notice).toContain('Fix:');
	});

	it('warns that a copied .env.example is not a configured one', () => {
		// The trap inside the fix: the advice this notice gives produces a file whose
		// names are all blank, and a reader who followed it deserves to know that.
		expect(notice).toContain('empty values');
	});

	it('names the 503s it is explaining, which is how a reader connects the two', () => {
		expect(notice).toContain('503');
		expect(notice).toContain('Graphics Administrator');
		expect(notice).toContain('Screen Output asset capabilities');
	});

	it('points at a document that carries the copy step it promises', () => {
		// Read rather than asserted, because a pointer to a step that has been edited
		// away is worse than no pointer: it costs the reader the trip and they arrive
		// at a hazard list with no instruction in it.
		//
		// The command itself rather than a mention of the filenames. The document
		// names both files a dozen times over — a check for that is satisfied by prose
		// about the problem, which is exactly what the reader already has.
		const doc = readFileSync(fileURLToPath(new URL('../../../docs/agents/parallel-rounds.md', import.meta.url)), 'utf8');

		expect(notice).toContain('docs/agents/parallel-rounds.md');
		expect(doc).toContain('cp .env .dev.vars');
	});
});

describe('reading a .dev.vars body', () => {
	it('reads plain, quoted and exported entries alike', () => {
		const values = parseDevVars([
			'NUXT_PLAIN=plain',
			'NUXT_DOUBLE="double value"',
			'NUXT_SINGLE=\'single value\'',
			'export NUXT_EXPORTED=exported',
			'NUXT_SPACED = spaced ',
		].join('\n'));

		expect(Object.fromEntries(values)).toEqual({
			NUXT_PLAIN: 'plain',
			NUXT_DOUBLE: 'double value',
			NUXT_SINGLE: 'single value',
			NUXT_EXPORTED: 'exported',
			NUXT_SPACED: 'spaced',
		});
	});

	it('ignores comments, blank lines and anything that is not an assignment', () => {
		const values = parseDevVars([
			'# The whole file is commented at the top',
			'',
			'   ',
			'not an assignment',
			'NUXT_KEPT=kept # trailing note',
			'NUXT_QUOTED="kept # inside quotes"',
		].join('\n'));

		expect(Object.fromEntries(values)).toEqual({
			NUXT_KEPT: 'kept',
			NUXT_QUOTED: 'kept # inside quotes',
		});
	});
});

describe('adopting a .dev.vars body into an environment', () => {
	it('copies the NUXT_-prefixed names that runtimeConfig reads', () => {
		const env: Record<string, string | undefined> = {};

		const adoption = adoptDevVars('NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY=key\n', env);

		expect(env.NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY).toBe('key');
		expect(adoption.adopted).toEqual(['NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY']);
	});

	it('leaves a Worker\'s own bindings where they are', () => {
		// Everything unprefixed in that file is a binding name meant for workerd.
		// Copying it into a Node process would put a name into scope that nothing
		// there is entitled to read.
		const env: Record<string, string | undefined> = {};

		adoptDevVars('SOME_BINDING=value\nDB=other\n', env);

		expect(env).toEqual({});
	});

	it('never overwrites a value the environment already carries', () => {
		// `.env` and the shell are the authoritative sources; `.dev.vars` only
		// fills what neither of them said.
		const env: Record<string, string | undefined> = { NUXT_GRAPHICS_ADMIN_TOKEN: 'from-env' };

		const adoption = adoptDevVars('NUXT_GRAPHICS_ADMIN_TOKEN=from-dev-vars\n', env);

		expect(env.NUXT_GRAPHICS_ADMIN_TOKEN).toBe('from-env');
		expect(adoption.adopted).toEqual([]);
		expect(adoption.retained).toEqual(['NUXT_GRAPHICS_ADMIN_TOKEN']);
	});

	it('does not adopt an empty value over a runtimeConfig default', () => {
		// `.dev.vars.example` ships its names with empty values, and a copied
		// blank would read as "configured" everywhere downstream.
		const env: Record<string, string | undefined> = {};

		const adoption = adoptDevVars('NUXT_GRAPHICS_ADMIN_TOKEN=""\n', env);

		expect('NUXT_GRAPHICS_ADMIN_TOKEN' in env).toBe(false);
		expect(adoption.adopted).toEqual([]);
	});
});
