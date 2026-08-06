import { describe, expect, it } from 'vitest';
import { adoptDevVars, adoptsDevVars, parseDevVars } from '~~/build/devVars';

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
