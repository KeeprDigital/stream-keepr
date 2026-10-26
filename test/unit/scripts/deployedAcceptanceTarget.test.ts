import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ACCOUNT_ID_ENV,
	loadCommittedInstallation,
	parseJsonc,
	resolveDeployedTarget,
} from '../../../scripts/graphics-acceptance/deployed-target.mjs';
import { OPERATOR_EMAIL_ENV, OPERATOR_PASSWORD_ENV } from '../../../scripts/graphics-acceptance/operator.mjs';

/**
 * The deployed target every `--deployed` gate shares (#619).
 *
 * The validator gate writes with Wrangler rather than over HTTP, so pointing the
 * acceptance URL elsewhere used to leave its writes on whatever account Wrangler
 * happened to be logged into. The resolver is pure so every refusal can be read
 * without an account in front of it.
 */

const ACCOUNT = '0123456789abcdef0123456789abcdef';

const COMPLETE_ENV = {
	STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: 'https://stream.keepr.digital/',
	[OPERATOR_EMAIL_ENV]: 'ops@keepr.digital',
	[OPERATOR_PASSWORD_ENV]: 'their-password',
	[ACCOUNT_ID_ENV]: ACCOUNT,
};

const APP = {
	routes: [
		{ pattern: 'stream.keepr.digital', custom_domain: true },
	],
	r2_buckets: [
		{ binding: 'GRAPHICS_ASSET_STAGING', bucket_name: 'stream-graphics-asset-staging' },
		{ binding: 'GRAPHICS_ASSET_CANONICAL', bucket_name: 'stream-graphics-asset-canonical' },
	],
	services: [
		{ binding: 'SILENT_VIDEO_PLAYBACK_VALIDATOR', service: 'stream-silent-video-validator' },
	],
};

const VALIDATOR = {
	name: 'stream-silent-video-validator',
	r2_buckets: [
		{ binding: 'GRAPHICS_ASSET_STAGING', bucket_name: 'stream-graphics-asset-staging' },
	],
	workflows: [
		{ name: 'silent-video-validation', binding: 'SILENT_VIDEO_VALIDATION_WORKFLOW' },
	],
};

function resolve(env: Record<string, string | undefined>, overrides: { app?: object; validator?: object } = {}) {
	return resolveDeployedTarget({
		env,
		installation: {
			app: overrides.app ?? APP,
			validator: overrides.validator ?? VALIDATOR,
			validatorConfigPath: '/repo/workers/silent-video-validator/wrangler.jsonc',
		},
	});
}

afterEach(() => vi.restoreAllMocks());

describe('the deployed acceptance target', () => {
	it('names the account, bucket and Workflow of the installation the URL names', () => {
		expect(resolve(COMPLETE_ENV)).toEqual({
			origin: 'https://stream.keepr.digital',
			accountId: ACCOUNT,
			stagingBucket: 'stream-graphics-asset-staging',
			workflow: 'silent-video-validation',
			validatorConfigPath: '/repo/workers/silent-video-validator/wrangler.jsonc',
		});
	});

	it('refuses an unset acceptance URL', () => {
		expect(() => resolve({ ...COMPLETE_ENV, STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: undefined }))
			.toThrow(expect.objectContaining({ code: 'harness-precondition-unmet' }));
	});

	it('refuses a run with no operator, before anything is written', () => {
		vi.spyOn(process.stderr, 'write').mockReturnValue(true);

		expect(() => resolve({ ...COMPLETE_ENV, [OPERATOR_PASSWORD_ENV]: undefined }))
			.toThrow(expect.objectContaining({ code: 'harness-operator-unavailable' }));
	});

	it('refuses to write with whichever account Wrangler happens to be logged into', () => {
		expect(() => resolve({ ...COMPLETE_ENV, [ACCOUNT_ID_ENV]: undefined }))
			.toThrow(expect.objectContaining({
				code: 'harness-precondition-unmet',
				detail: { reason: 'CLOUDFLARE_ACCOUNT_ID is unset' },
			}));
		expect(() => resolve({ ...COMPLETE_ENV, [ACCOUNT_ID_ENV]: 'not-an-account' }))
			.toThrow(expect.objectContaining({
				code: 'harness-target-inconsistent',
				detail: { reason: 'account-malformed' },
			}));
	});

	it('refuses an alternate URL, so retargeting it cannot leave the validator writing production', () => {
		expect(() => resolve({ ...COMPLETE_ENV, STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: 'https://staging.keepr.digital' }))
			.toThrow(expect.objectContaining({
				code: 'harness-target-inconsistent',
				detail: { reason: 'origin-not-installation' },
			}));
	});

	it('refuses an installation whose validator stages elsewhere than its app', () => {
		expect(() => resolve(COMPLETE_ENV, {
			validator: {
				...VALIDATOR,
				r2_buckets: [
					{ binding: 'GRAPHICS_ASSET_STAGING', bucket_name: 'other' },
				],
			},
		})).toThrow(expect.objectContaining({
			detail: { reason: 'staging-bucket-mismatch' },
		}));
		expect(() => resolve(COMPLETE_ENV, {
			validator: { ...VALIDATOR, name: 'some-other-validator' },
		}))
			.toThrow(expect.objectContaining({
				detail: { reason: 'validator-service-mismatch' },
			}));
		expect(() => resolve(COMPLETE_ENV, {
			validator: { ...VALIDATOR, workflows: [] },
		}))
			.toThrow(expect.objectContaining({
				detail: { reason: 'workflow-unconfigured' },
			}));
	});

	it('refuses an account the installation\'s own config contradicts', () => {
		expect(() => resolve(COMPLETE_ENV, {
			app: {
				...APP,
				account_id: 'f'.repeat(32),
			},
		}))
			.toThrow(expect.objectContaining({
				detail: { reason: 'account-mismatch' },
			}));
		expect(resolve(COMPLETE_ENV, {
			validator: { ...VALIDATOR, account_id: ACCOUNT },
		}).accountId).toBe(ACCOUNT);
	});

	it('resolves the committed production installation', async () => {
		const installation = await loadCommittedInstallation();

		expect(installation.validatorConfigPath)
			.toBe(join(import.meta.dirname, '../../../workers/silent-video-validator/wrangler.jsonc'));
		expect(resolveDeployedTarget({ env: COMPLETE_ENV, installation })).toMatchObject({
			stagingBucket: 'stream-graphics-asset-staging',
			workflow: 'silent-video-validation',
		});
	});
});

describe('reading a Wrangler config', () => {
	it('drops comments and trailing commas, and leaves strings alone', () => {
		expect(parseJsonc('{\n\t// a comment\n\t"a": "x // y", /* b */ "b": [1, 2,],\n}')).toEqual({
			a: 'x // y',
			b: [1, 2],
		});
	});
});
