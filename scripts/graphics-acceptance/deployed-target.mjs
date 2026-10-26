/**
 * The one deployed target every `--deployed` gate runs against, resolved and
 * checked before any gate writes anything (#619).
 *
 * Most gates reach the installation over HTTP, so the acceptance URL alone says
 * where they write. The silent-video validator gate cannot: it stages fixtures
 * with Wrangler and triggers the Workflow directly, so before this it wrote to
 * whatever account Wrangler was logged into and the bucket its committed config
 * named, whatever URL the run was pointed at. The target here ties the two
 * together: one URL, one explicit account, and the bucket and Workflow the
 * installation that URL names actually binds.
 *
 * "The installation" is a pair of Wrangler configs, the app's and the
 * validator's. The committed pair is production's; #525's staging will be
 * another pair passed to the same resolver. Every consistency rule is checked
 * against the pair, so an alternate URL with production's configs is refused
 * rather than quietly sending the validator's writes to production.
 *
 * Resolution is pure. Nothing here opens a connection, which is what lets
 * `pnpm accept deployed` run it for the whole sequence before its first gate.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AcceptanceFailure } from './evidence.mjs';
import { acceptanceOrigin } from './installation.mjs';
import { newOperatorPassword, operatorCredentialPlan } from './operator.mjs';

/** Wrangler's own name for the account, so the value it is given is the value it uses. */
export const ACCOUNT_ID_ENV = 'CLOUDFLARE_ACCOUNT_ID';

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/;
const STAGING_BINDING = 'GRAPHICS_ASSET_STAGING';
const VALIDATOR_SERVICE_BINDING = 'SILENT_VIDEO_PLAYBACK_VALIDATOR';
const WORKFLOW_BINDING = 'SILENT_VIDEO_VALIDATION_WORKFLOW';

const APP_CONFIG = new URL('../../wrangler.jsonc', import.meta.url);
const VALIDATOR_CONFIG = new URL('../../workers/silent-video-validator/wrangler.jsonc', import.meta.url);

/**
 * JSON with comments and trailing commas, as Wrangler configs are written.
 * String-aware, so a `//` inside a value survives.
 */
export function parseJsonc(text) {
	let out = '';
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === '"') {
			const start = index;
			for (index += 1; index < text.length && text[index] !== '"'; index += 1) {
				if (text[index] === '\\')
					index += 1;
			}
			out += text.slice(start, index + 1);
		}
		else if (char === '/' && text[index + 1] === '/') {
			while (index < text.length && text[index] !== '\n')
				index += 1;
			out += '\n';
		}
		else if (char === '/' && text[index + 1] === '*') {
			index = text.indexOf('*/', index + 2);
			if (index < 0)
				break;
			index += 1;
		}
		else if (char !== ',' || !/^\s*[\]}]/.test(text.slice(index + 1))) {
			out += char;
		}
	}
	return JSON.parse(out);
}

/** The committed production installation: the app's and the validator's configs. */
export async function loadCommittedInstallation() {
	const [app, validator] = await Promise.all([APP_CONFIG, VALIDATOR_CONFIG].map(async url =>
		parseJsonc(await readFile(url, 'utf8'))));
	return {
		app,
		validator,
		validatorConfigPath: fileURLToPath(VALIDATOR_CONFIG),
	};
}

function inconsistent(reason) {
	return new AcceptanceFailure('harness-target-inconsistent', { reason });
}

function bucketBound(config, binding) {
	return config.r2_buckets?.find(bucket => bucket.binding === binding)?.bucket_name;
}

/** The staging bucket a Wrangler config binds, the one the validator reads sources from. */
export function stagingBucketOf(config) {
	return bucketBound(config, STAGING_BINDING);
}

/** Every host the app's config serves, from its `routes`. */
function servedHosts(app) {
	return (app.routes ?? []).map(route => (typeof route === 'string'
		? route
		: route.pattern)).filter(Boolean).map(pattern => pattern.replace(/\/.*$/, '').toLowerCase());
}

/**
 * Everything a deployed run needs, or the first thing it lacks.
 *
 * Checked in the order a reader fixes them: the URL, the operator, the account,
 * then whether the installation's configs agree with each other and with the
 * URL. Every refusal is an `AcceptanceFailure` whose detail is a reason word or
 * a configuration name, never a value.
 *
 * @param {{
 *   env: Record<string, string | undefined>,
 *   installation: { app: any, validator: any, validatorConfigPath: string },
 *   requireOperator?: boolean,
 * }} options
 */
export function resolveDeployedTarget({ env, installation, requireOperator = true }) {
	const origin = acceptanceOrigin({ deployed: true, env });
	// Called for its refusal: it throws, with its notice, when no operator is
	// available. A cleanup retry signs in as nobody, so it does not ask.
	if (requireOperator) {
		operatorCredentialPlan({
			deployed: true,
			env,
			newPassword: newOperatorPassword(),
		});
	}

	const accountId = env[ACCOUNT_ID_ENV]?.trim();
	if (!accountId)
		throw new AcceptanceFailure('harness-precondition-unmet', { reason: `${ACCOUNT_ID_ENV} is unset` });
	if (!ACCOUNT_ID_PATTERN.test(accountId))
		throw inconsistent('account-malformed');

	const { app, validator, validatorConfigPath } = installation;
	let host;
	try {
		host = new URL(origin).host.toLowerCase();
	}
	catch {
		throw inconsistent('origin-malformed');
	}
	if (!servedHosts(app).includes(host))
		throw inconsistent('origin-not-installation');

	for (const config of [app, validator]) {
		if (config.account_id !== undefined && config.account_id !== accountId)
			throw inconsistent('account-mismatch');
	}

	const stagingBucket = bucketBound(validator, STAGING_BINDING);
	if (!stagingBucket || stagingBucket !== bucketBound(app, STAGING_BINDING))
		throw inconsistent('staging-bucket-mismatch');

	const service = app.services?.find(entry => entry.binding === VALIDATOR_SERVICE_BINDING)?.service;
	if (!service || service !== validator.name)
		throw inconsistent('validator-service-mismatch');

	const workflow = validator.workflows?.find(entry => entry.binding === WORKFLOW_BINDING)?.name;
	if (!workflow)
		throw inconsistent('workflow-unconfigured');

	return {
		origin,
		accountId,
		stagingBucket,
		workflow,
		validatorConfigPath,
	};
}
