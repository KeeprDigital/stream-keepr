import { readFileSync } from 'node:fs';
import process from 'node:process';
import { defineNuxtModule, useLogger } from 'nuxt/kit';
import { adoptDevVarsInto, DEV_VARS_ABSENT_NOTICE } from './devVars';

/**
 * Gives `nuxt dev` the same `NUXT_` environment the deployed Worker has, by
 * adopting `.dev.vars` into `process.env` before anything reads runtimeConfig.
 *
 * Every decision — which processes may do this, which names travel, and what
 * happens to one already set — belongs to `adoptDevVarsInto`, where it can be
 * exercised without booting Nuxt. What is left here is the two things only Nuxt
 * can supply: where the project root is, and where to log.
 */
export const devVarsModule = defineNuxtModule({
	meta: { name: 'dev-vars' },
	setup(_options, nuxt) {
		const { adopted, outcome } = adoptDevVarsInto({
			dev: nuxt.options.dev,
			env: process.env,
			read: () => {
				try {
					return readFileSync(new URL('.dev.vars', `file://${nuxt.options.rootDir}/`), 'utf8');
				}
				catch {
					return null;
				}
			},
		});

		const logger = useLogger('dev-vars');
		if (outcome === 'absent')
			logger.warn(DEV_VARS_ABSENT_NOTICE);
		else if (adopted.length > 0)
			logger.info(`Using ${adopted.join(', ')} from .dev.vars`);
	},
});
