import { readFileSync } from 'node:fs';
import process from 'node:process';
import { defineNuxtModule, useLogger } from 'nuxt/kit';
import { adoptDevVars } from './devVars';

/**
 * Gives `nuxt dev` the same `NUXT_` environment the deployed Worker has, by
 * adopting `.dev.vars` into `process.env` before anything reads runtimeConfig.
 *
 * Development only. In a build these names come from real secrets, and reading
 * a local file there would bake a developer's key into the output.
 */
export const devVarsModule = defineNuxtModule({
	meta: { name: 'dev-vars' },
	setup(_options, nuxt) {
		if (!nuxt.options.dev)
			return;

		let source: string;
		try {
			source = readFileSync(new URL('.dev.vars', `file://${nuxt.options.rootDir}/`), 'utf8');
		}
		catch {
			return;
		}

		const { adopted } = adoptDevVars(source, process.env);
		if (adopted.length > 0)
			useLogger('dev-vars').info(`Using ${adopted.join(', ')} from .dev.vars`);
	},
});
