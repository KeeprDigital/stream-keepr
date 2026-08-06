import { describe, expect, it } from 'vitest';
import { adoptDevVars, parseDevVars } from '~~/build/devVars';

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
