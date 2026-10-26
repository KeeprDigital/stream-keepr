import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteCommandFailure } from '../../../scripts/graphics-acceptance/validator-commands.mjs';
import { main } from '../../../scripts/run-silent-video-validator-acceptance.mjs';

/**
 * The deployed silent-video validator gate, driven against a fake command
 * adapter (#619). Nothing here reaches Wrangler or an account: the adapter is
 * the only way the runner touches either, and the fake records every call.
 */

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const BUCKET = 'stream-graphics-asset-staging';
const WORKFLOW = 'silent-video-validation';

const ENV = {
	STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: 'https://stream.keepr.digital',
	STREAM_KEEPR_ACCEPTANCE_OPERATOR_EMAIL: 'ops@keepr.digital',
	STREAM_KEEPR_ACCEPTANCE_OPERATOR_PASSWORD: 'their-password',
	CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
};

const INSTALLATION = {
	app: {
		routes: [
			{ pattern: 'stream.keepr.digital', custom_domain: true },
		],
		r2_buckets: [
			{ binding: 'GRAPHICS_ASSET_STAGING', bucket_name: BUCKET },
		],
		services: [
			{ binding: 'SILENT_VIDEO_PLAYBACK_VALIDATOR', service: 'stream-silent-video-validator' },
		],
	},
	validator: {
		name: 'stream-silent-video-validator',
		r2_buckets: [
			{ binding: 'GRAPHICS_ASSET_STAGING', bucket_name: BUCKET },
		],
		workflows: [
			{ name: WORKFLOW, binding: 'SILENT_VIDEO_VALIDATION_WORKFLOW' },
		],
	},
	validatorConfigPath: '/repo/workers/silent-video-validator/wrangler.jsonc',
};

const MUTATIONS = new Set(['put', 'trigger', 'delete']);

/**
 * A command failure whose message carries everything the evidence contract
 * withholds, so a runner that printed a message would fail `expectSafe`.
 */
function rawFailure(step: string, key: string) {
	return Object.assign(new RemoteCommandFailure(step, 1), {
		message: `wrangler r2 object ${step} ${BUCKET}/${key} --remote: ✘ [ERROR] ${'a'.repeat(64)}`,
	});
}

interface FakeOptions {
	failPut?: boolean;
	failDeletes?: number;
	failProbe?: 'bucket' | 'workflow';
	outcome?: string;
	neverSettle?: boolean;
}

function fakeCommands(options: FakeOptions = {}) {
	const calls: { op: string; accountId: string; bucket?: string; workflow?: string; key?: string }[] = [];
	const objects = new Map<string, Uint8Array>();
	const instances = new Map<string, object>();
	let deleteFailures = options.failDeletes ?? 0;
	const log = (op: string, target: { accountId: string; stagingBucket: string; workflow: string }, key?: string) =>
		calls.push({
			op,
			accountId: target.accountId,
			bucket: target.stagingBucket,
			workflow: target.workflow,
			key,
		});

	return {
		calls,
		objects,
		async probeBucket({ target }: any) {
			log('probe-bucket', target);
			if (options.failProbe === 'bucket')
				throw rawFailure('info', '');
		},
		async probeWorkflow({ target }: any) {
			log('probe-workflow', target);
			if (options.failProbe === 'workflow')
				throw rawFailure('describe', '');
		},
		async putObject({ target, key, bytes }: any) {
			log('put', target, key);
			if (options.failPut)
				throw rawFailure('put', key);
			objects.set(key, bytes);
		},
		async getObject({ target, key }: any) {
			log('get', target, key);
			return objects.get(key);
		},
		async deleteObject({ target, key }: any) {
			log('delete', target, key);
			if (deleteFailures > 0) {
				deleteFailures -= 1;
				throw rawFailure('delete', key);
			}
			objects.delete(key);
		},
		/** Plays the deployed Workflow: renders a poster and settles with its output. */
		async triggerWorkflow({ target, id, params }: any) {
			log('trigger', target);
			const posterKey = `validation/silent-video/${id}/poster`;
			const poster = Buffer.from(`poster for ${id}`);
			objects.set(posterKey, poster);
			instances.set(id, {
				outcome: options.outcome ?? 'accepted',
				idempotencyKey: params.idempotencyKey,
				mutedInlinePlayback: true,
				seeked: true,
				transparencyRendered: true,
				posterKey,
				posterDigest: createHash('sha256').update(poster).digest('hex'),
			});
		},
		async describeInstance({ target, id }: any) {
			log('describe', target);
			return options.neverSettle
				? { status: 'Running' }
				: {
						status: 'Complete',
						output: instances.get(id),
					};
		},
	};
}

let workspace: string;
let manifestPath: string;
let output: string;

beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), 'validator-acceptance-test-'));
	manifestPath = join(workspace, 'cleanup.json');
	output = '';
	const capture = (chunk: unknown) => {
		output += String(chunk);
		return true;
	};
	vi.spyOn(process.stdout, 'write').mockImplementation(capture);
	vi.spyOn(process.stderr, 'write').mockImplementation(capture);
});

afterEach(async () => {
	vi.restoreAllMocks();
	process.exitCode = undefined;
	await rm(workspace, { recursive: true, force: true });
});

async function run(commands: ReturnType<typeof fakeCommands>, { env = ENV as Record<string, string | undefined>, flags = ['--deployed'] } = {}) {
	const openSession = vi.fn(async () => ['session=a-session-cookie-value']);
	process.exitCode = undefined;
	await main(['node', 'run-silent-video-validator-acceptance.mjs', ...flags], {
		commands,
		env,
		installation: INSTALLATION,
		manifestPath,
		openSession,
		pollIntervalMs: 0,
	});
	return { exitCode: process.exitCode, openSession };
}

function mutations(commands: ReturnType<typeof fakeCommands>) {
	return commands.calls.filter(call => MUTATIONS.has(call.op));
}

/** Nothing the evidence contract withholds: keys, digests, ids, filenames, Wrangler arguments, raw stderr. */
function expectSafe(text: string) {
	expect(text).not.toMatch(/ingestion\/|validation\/silent-video|acceptance-[a-z0-9]+-|[0-9a-f]{32}|--remote|\[ERROR\]|\.mp4|\.webm/u);
}

describe('deployed validator acceptance: preflight', () => {
	it.each([
		[
			'no account',
			{ ...ENV, CLOUDFLARE_ACCOUNT_ID: undefined },
			'harness-precondition-unmet',
		],
		[
			'no acceptance URL',
			{ ...ENV, STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: undefined },
			'harness-precondition-unmet',
		],
		[
			'no operator',
			{ ...ENV, STREAM_KEEPR_ACCEPTANCE_OPERATOR_PASSWORD: undefined },
			'harness-operator-unavailable',
		],
		[
			'an alternate URL',
			{ ...ENV, STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: 'https://staging.keepr.digital' },
			'harness-target-inconsistent',
		],
	])('touches nothing with %s', async (_, env, code) => {
		const commands = fakeCommands();
		const { exitCode, openSession } = await run(commands, { env });

		expect(exitCode).toBe(1);
		expect(commands.calls).toEqual([]);
		expect(openSession).not.toHaveBeenCalled();
		expect(output).toContain(`silent-video-validator-v1 ${code}`);
		expect(existsSync(manifestPath)).toBe(false);
		expectSafe(output);
	});

	it.each(['bucket', 'workflow'] as const)('writes nothing when the account does not hold the %s', async (probe) => {
		const commands = fakeCommands({ failProbe: probe });
		const { exitCode, openSession } = await run(commands);

		expect(exitCode).toBe(1);
		expect(mutations(commands)).toEqual([]);
		// A bootstrapping sign-in creates or resets an account, so it waits for the probes.
		expect(openSession).not.toHaveBeenCalled();
		expect(output).toContain(`silent-video-validator-v1 harness-target-unverified step=${probe}`);
		expectSafe(output);
	});

	it('signs in as the operator before the first write', async () => {
		const commands = fakeCommands();
		const { openSession } = await run(commands);

		expect(openSession).toHaveBeenCalledWith('https://stream.keepr.digital');
	});

	it('cannot reach Wrangler from an imported main that injected nothing', async () => {
		// Only the CLI entry point passes the real commands (#619).
		await main(['node', 'run-silent-video-validator-acceptance.mjs', '--deployed'], {
			env: ENV,
			installation: INSTALLATION,
			manifestPath,
		});

		expect(process.exitCode).toBe(1);
		expect(output).toContain('silent-video-validator-v1 harness-precondition-unmet reason=Error');
		expect(existsSync(manifestPath)).toBe(false);
	});
});

describe('deployed validator acceptance: routing', () => {
	it('stages, triggers, reads and deletes only in the resolved account, bucket and Workflow', async () => {
		const commands = fakeCommands();
		const { exitCode } = await run(commands);

		expect(exitCode).toBeUndefined();
		expect(new Set(commands.calls.map(({ accountId, bucket, workflow }) => `${accountId} ${bucket} ${workflow}`)))
			.toEqual(new Set([`${ACCOUNT} ${BUCKET} ${WORKFLOW}`]));
		expect(commands.calls.filter(call => call.op === 'put')).toHaveLength(3);
		expect(commands.calls.filter(call => call.op === 'trigger')).toHaveLength(3);
		expect(commands.objects.size).toBe(0);
		expect(existsSync(manifestPath)).toBe(false);
		expect(output.trim()).toBe('silent-video-validator-v1 acceptance passed checks=3 fixtures=3 cleaned=6');
	});
});

describe('deployed validator acceptance: redacted failures', () => {
	it('names the failed step without the key, arguments or stderr, and still cleans up', async () => {
		const commands = fakeCommands({ failPut: true });
		const { exitCode } = await run(commands);

		expect(exitCode).toBe(1);
		expect(output).toContain('silent-video-validator-v1 validator-command-failed fixture=h264Mp4 step=put exit=1');
		expectSafe(output);
		// The source was recorded before its put, so cleanup tries it even though
		// the put's own outcome is unknown.
		expect(commands.calls.filter(call => call.op === 'delete')).toHaveLength(1);
		expect(existsSync(manifestPath)).toBe(false);
	});

	it('reports an inexact acceptance by field, never by dumping the Workflow output', async () => {
		const commands = fakeCommands({ outcome: 'rejected' });
		await run(commands);

		expect(output).toContain('silent-video-validator-v1 validator-output-unexpected fixture=h264Mp4 field=outcome');
		expectSafe(output);
	});
});

describe('deployed validator acceptance: cleanup', () => {
	it('fails a run whose deletion failed, keeps the manifest, and refuses the next run until a retry', async () => {
		const failing = fakeCommands({ failDeletes: 2 });
		const first = await run(failing);

		expect(first.exitCode).toBe(1);
		expect(output).toContain('silent-video-validator-v1 harness-cleanup-incomplete remaining=2');
		expect(output).not.toContain('acceptance passed');
		expectSafe(output);
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		expect(manifest.target).toEqual({ accountId: ACCOUNT, stagingBucket: BUCKET, workflow: WORKFLOW });
		expect(manifest.objects).toHaveLength(2);

		output = '';
		const blocked = fakeCommands();
		const second = await run(blocked);
		expect(second.exitCode).toBe(1);
		expect(output).toContain('silent-video-validator-v1 harness-cleanup-pending remaining=2');
		expect(mutations(blocked)).toEqual([]);

		output = '';
		const retry = fakeCommands();
		for (const { key } of manifest.objects)
			retry.objects.set(key, new Uint8Array(1));
		// A retry signs in as nobody, so it does not need the operator.
		const retried = await run(retry, {
			env: { ...ENV, STREAM_KEEPR_ACCEPTANCE_OPERATOR_PASSWORD: undefined },
			flags: ['--deployed', '--cleanup'],
		});
		expect(retried.exitCode).toBeUndefined();
		expect(retry.objects.size).toBe(0);
		expect(output.trim()).toBe('silent-video-validator-v1 acceptance passed checks=1 cleaned=2');
		expect(existsSync(manifestPath)).toBe(false);

		// Idempotent: a second retry finds nothing and deletes nothing.
		output = '';
		const again = fakeCommands();
		expect((await run(again, {
			flags: ['--deployed', '--cleanup'],
		})).exitCode).toBeUndefined();
		expect(mutations(again)).toEqual([]);
		expect(output.trim()).toBe('silent-video-validator-v1 acceptance passed checks=1 cleaned=0');
	});

	it('keeps a poster listed while its Workflow has not settled, and a later retry clears it', async () => {
		const unsettled = fakeCommands({ neverSettle: true });
		const first = await run(unsettled);

		expect(first.exitCode).toBe(1);
		expect(output).toContain('silent-video-validator-v1 validator-did-not-settle fixture=h264Mp4');
		// The source is gone; the poster the instance may still write is not forgotten.
		expect(output).toContain('silent-video-validator-v1 harness-cleanup-incomplete remaining=1');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		expect(manifest.objects).toEqual([
			{
				key: expect.stringMatching(/^validation\/silent-video\//u),
				instance: expect.any(String),
			},
		]);
		expectSafe(output);

		output = '';
		const settled = fakeCommands();
		expect((await run(settled, {
			flags: ['--deployed', '--cleanup'],
		})).exitCode).toBeUndefined();
		expect(output.trim()).toBe('silent-video-validator-v1 acceptance passed checks=1 cleaned=1');
		expect(existsSync(manifestPath)).toBe(false);
	});

	it('treats a manifest that lists nothing as no manifest, so a run killed before its first write blocks nothing', async () => {
		await mkdir(workspace, { recursive: true });
		await writeFile(manifestPath, JSON.stringify({
			version: 1,
			target: { accountId: ACCOUNT, stagingBucket: BUCKET, workflow: WORKFLOW },
			objects: [],
		}));

		expect((await run(fakeCommands())).exitCode).toBeUndefined();
		expect(existsSync(manifestPath)).toBe(false);
	});

	it('keeps what a retry could not delete, and deletes the rest', async () => {
		await run(fakeCommands({ failDeletes: 2 }));
		output = '';

		const retried = await run(fakeCommands({ failDeletes: 1 }), {
			flags: ['--deployed', '--cleanup'],
		});

		expect(retried.exitCode).toBe(1);
		expect(output).toContain('harness-cleanup-incomplete remaining=1');
		expect(JSON.parse(await readFile(manifestPath, 'utf8')).objects).toHaveLength(1);
	});

	it('refuses to retry a manifest written for another account', async () => {
		await run(fakeCommands({ failDeletes: 1 }));
		output = '';

		const other = fakeCommands();
		const retried = await run(other, {
			env: {
				...ENV,
				CLOUDFLARE_ACCOUNT_ID: 'f'.repeat(32),
			},
			flags: ['--deployed', '--cleanup'],
		});

		expect(retried.exitCode).toBe(1);
		expect(output).toContain('harness-target-inconsistent reason=manifest-target-mismatch');
		expect(mutations(other)).toEqual([]);
		expectSafe(output);
	});
});
