import { readFileSync } from 'node:fs';
import process from 'node:process';
import { defineNuxtModule, useLogger } from 'nuxt/kit';
import { adoptDevVars, adoptsDevVars } from './devVars';

/**
 * Gives `nuxt dev` the same `NUXT_` environment the deployed Worker has, by
 * adopting `.dev.vars` into `process.env` before anything reads runtimeConfig.
 *
 * Which processes may do that is `adoptsDevVars`' question, and is asked there
 * so it can be exercised without booting Nuxt.
 */
export const devVarsModule = defineNuxtModule({
	meta: { name: 'dev-vars' },
	setup(_options, nuxt) {
		if (!adoptsDevVars({ dev: nuxt.options.dev, env: process.env }))
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
