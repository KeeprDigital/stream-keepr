import process from 'node:process';
import { defineNuxtModule, useLogger } from 'nuxt/kit';
import {
	localAuthBypassActive,
	localAuthBypassLogLine,
	localConfigurationLogLine,
} from './localConfiguration';

/**
 * Says once, at boot, that this checkout cannot supply the names its surfaces need
 * — before those surfaces answer 503 one at a time and none of them names the cause
 * (#130).
 *
 * Every decision — which runs may say it, which names count, and what the sentence
 * is — belongs to `localConfiguration`, where it can be exercised without booting
 * Nuxt. What is left here is the one thing only Nuxt can supply: where to log.
 *
 * It used to read `.dev.vars` as well and copy its `NUXT_`-prefixed names into
 * `process.env`, because a value living only in that file reached the proxied
 * Cloudflare bindings and never reached runtimeConfig. #412 deleted the file: `.env`
 * is the whole of local configuration, Nuxt loads it into `process.env` before this
 * `setup` runs, and there is nothing left to bridge.
 */
export const localConfigurationModule = defineNuxtModule({
	meta: { name: 'local-configuration' },
	setup(_options, nuxt) {
		const context = { dev: nuxt.options.dev, env: process.env };
		const bypassActive = localAuthBypassActive(context);
		const logger = useLogger('local-configuration');
		for (const line of [
			localAuthBypassLogLine(context, bypassActive),
			localConfigurationLogLine(context, bypassActive),
		]) {
			if (line !== undefined)
				logger[line.level](line.message);
		}
	},
});
