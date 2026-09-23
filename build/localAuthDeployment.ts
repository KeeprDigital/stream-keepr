import { LOCAL_AUTH_BYPASS_NAME } from '../shared/utils/localDeveloperAuth.ts';

/**
 * Keep the launcher-owned local-authentication choice out of every deployable
 * Wrangler configuration branch, including named environments.
 *
 * The one guard #519 kept, and the only one it had reason to. This reads what a
 * deploy is about to upload rather than the environment a command was run in, so
 * it cannot refuse a build, a test, or a bypassed local launcher —
 * the `dev:` bypass launchers set the name in a process, not in this file, and
 * `pnpm preview:bypass` stages it into `.output/server/.env`, which is not
 * Wrangler configuration and is not uploaded. What it catches is the accident
 * the name being launcher-owned makes rare rather than impossible: the name
 * written into `wrangler.jsonc`, or into a `vars` block a generator produced,
 * where it would deploy as an unauthenticated installation.
 *
 * It scanned for the launcher attestation of the two-name scheme until #519
 * collapsed it; the scan is the same shape, over the name that is now the whole
 * of the decision.
 */
export function assertWorkerConfigurationDoesNotArmLocalAuthBypass(configuration: unknown): void {
	if (configurationArmsLocalAuthBypass(configuration)) {
		throw new Error(
			`Generated Worker configuration contains ${LOCAL_AUTH_BYPASS_NAME}; refusing to deploy an installation that bypasses authentication.`,
		);
	}
}

function configurationArmsLocalAuthBypass(value: unknown): boolean {
	if (Array.isArray(value))
		return value.some(configurationArmsLocalAuthBypass);
	if (value === null || typeof value !== 'object')
		return false;
	return Object.entries(value).some(([name, nested]) =>
		name === LOCAL_AUTH_BYPASS_NAME || configurationArmsLocalAuthBypass(nested),
	);
}
