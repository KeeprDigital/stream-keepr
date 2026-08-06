import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adoptDevVars, adoptDevVarsInto, adoptsDevVars, DEV_VARS_ABSENT_NOTICE, parseDevVars } from '~~/build/devVars';

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
		expect(adoption).toEqual({ adopted: [], retained: [], outcome: 'refused' });
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
			.toEqual({ adopted: [], retained: [], outcome: 'absent' });
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
describe('announcing a checkout with no local configuration', () => {
	it('is the absent case, and only the absent case', () => {
		// The three outcomes exist for this: a build and the integration suite adopt
		// nothing deliberately, and a caller reading `adopted.length === 0` would warn
		// both of them, every run, about a file they refused to open on purpose.
		const absent = adoptDevVarsInto({ dev: true, env: {}, read: () => null });
		const refusedByIntegration = adoptDevVarsInto({
			dev: true,
			env: { STREAM_KEEPR_INTEGRATION: 'true' },
			read: () => null,
		});
		const refusedByBuild = adoptDevVarsInto({ dev: false, env: {}, read: () => null });

		expect(absent.outcome).toBe('absent');
		expect(refusedByIntegration.outcome).toBe('refused');
		expect(refusedByBuild.outcome).toBe('refused');
	});

	it('is not the case where the file exists and had nothing left to give', () => {
		// A developer whose shell already carries every name reads a file that adopted
		// nothing. Telling them their checkout has no local configuration would be a
		// false statement about the one thing the notice is asserting.
		const env: Record<string, string | undefined> = { NUXT_GRAPHICS_ADMIN_TOKEN: 'from-shell' };

		const adoption = adoptDevVarsInto({ dev: true, env, read: () => 'NUXT_GRAPHICS_ADMIN_TOKEN=from-file\n' });

		expect(adoption.adopted).toEqual([]);
		expect(adoption.outcome).toBe('read');
	});

	it('names both gitignored files, so the reader knows what to copy', () => {
		// `.env` as well as `.dev.vars`: a worktree is missing both, and a notice that
		// named only the file it happened to look for would send the reader back for
		// the other one after the next 503.
		expect(DEV_VARS_ABSENT_NOTICE).toContain('.dev.vars');
		expect(DEV_VARS_ABSENT_NOTICE).toContain('.env');
		expect(DEV_VARS_ABSENT_NOTICE).toContain('.env.example');
		expect(DEV_VARS_ABSENT_NOTICE).toContain('.dev.vars.example');
	});

	it('names the cause and the fix, not just the condition', () => {
		// "No .dev.vars" on its own is the state a reader can already see. What they
		// cannot see is that a worktree is why, and that a copy closes it.
		expect(DEV_VARS_ABSENT_NOTICE).toContain('git worktree');
		expect(DEV_VARS_ABSENT_NOTICE).toContain('gitignored');
		expect(DEV_VARS_ABSENT_NOTICE).toContain('Fix:');
	});

	it('names the 503s it is explaining, which is how a reader connects the two', () => {
		// The reader arrives at this notice from a 503, or arrives at the 503 having
		// scrolled past this notice. Either direction needs the words to match.
		expect(DEV_VARS_ABSENT_NOTICE).toContain('503');
		expect(DEV_VARS_ABSENT_NOTICE).toContain('Graphics Administrator');
		expect(DEV_VARS_ABSENT_NOTICE).toContain('Screen Output asset capabilities');
	});

	it('points at a document that carries the worktree setup step', () => {
		// Read rather than asserted, because a pointer to a section that has been
		// renamed away is worse than no pointer: it costs the reader the trip.
		const doc = readFileSync(fileURLToPath(new URL('../../../docs/agents/parallel-rounds.md', import.meta.url)), 'utf8');

		expect(DEV_VARS_ABSENT_NOTICE).toContain('docs/agents/parallel-rounds.md');
		expect(doc).toContain('.dev.vars');
		expect(doc).toContain('.env');
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
