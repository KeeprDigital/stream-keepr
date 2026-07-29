import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { GraphicAssetSilentVideoFacts } from '../../../shared/types/graphicsAsset';
import { Container } from '@cloudflare/containers';
import { WorkflowEntrypoint } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';

/**
 * Private production runtime for the Graphics Asset Library
 * `SilentVideoPlaybackValidator` boundary. The stream Worker calls this
 * service through the `SILENT_VIDEO_PLAYBACK_VALIDATOR` service binding; each
 * validation idempotency key starts or reconnects exactly one idempotent
 * Workflow, which proves complete decode, muted inline playback, deterministic
 * seeking, and VP9 transparency inside a pinned scale-to-zero Container before
 * producing the deterministic poster.
 */

interface ValidatorEnv {
	GRAPHICS_ASSET_STAGING: R2Bucket;
	SILENT_VIDEO_VALIDATION_WORKFLOW: Workflow<SilentVideoValidationParams>;
	SILENT_VIDEO_VALIDATION_CONTAINER: DurableObjectNamespace<SilentVideoValidationContainer>;
}

interface SilentVideoValidationParams {
	operationId: string;
	idempotencyKey: string;
	sourceDigest: string;
	sourceByteLength: number;
	sourceContentType: 'video/mp4' | 'video/webm';
	factsDigest: string;
	inspectedFacts: GraphicAssetSilentVideoFacts;
}

type RejectionStage = 'metadata' | 'playback' | 'seek' | 'poster' | 'transparency';

interface ValidationBindingEcho {
	operationId: string;
	idempotencyKey: string;
	sourceDigest: string;
	factsDigest: string;
}

type SilentVideoValidationOutput
	= | (ValidationBindingEcho & {
		outcome: 'accepted';
		width: number;
		height: number;
		durationSeconds: number;
		posterTimeSeconds: number;
		mutedInlinePlayback: true;
		seeked: true;
		transparencyRendered: boolean;
		posterKey: string;
		posterDigest: string;
		posterByteLength: number;
	})
	| (ValidationBindingEcho & {
		outcome: 'rejected';
		stage: RejectionStage;
	});

type ContainerValidationResponse
	= | {
		outcome: 'accepted';
		width: number;
		height: number;
		durationSeconds: number;
		mutedInlinePlayback: true;
		seeked: true;
		transparencyRendered: boolean;
		posterBase64: string;
		posterDigest: string;
	}
	| {
		outcome: 'rejected';
		stage: RejectionStage;
		detail?: string;
	};

const MAX_SILENT_VIDEO_POSTER_BYTES = 2 * 1024 * 1024;
const RESULT_POLL_DEADLINE_MILLISECONDS = 22_000;
const RESULT_POLL_INTERVAL_MILLISECONDS = 750;

const textEncoder = new TextEncoder();

async function sha256Hex(bytes: Uint8Array | ArrayBuffer) {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		bytes instanceof Uint8Array ? bytes as unknown as BufferSource : bytes,
	);
	return [...new Uint8Array(digest)]
		.map(value => value.toString(16).padStart(2, '0'))
		.join('');
}

function posterObjectKey(validationId: string) {
	return `validation/silent-video/${validationId}/poster`;
}

function stagedSourceKey(operationId: string) {
	return `ingestion/${operationId}/source`;
}

function posterFitDimensions(facts: GraphicAssetSilentVideoFacts) {
	const scale = Math.min(1, 640 / facts.width, 360 / facts.height);
	return {
		width: Math.max(1, Math.round(facts.width * scale)),
		height: Math.max(1, Math.round(facts.height * scale)),
	};
}

function decodeBase64(value: string) {
	const binary = atob(value);
	return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export class SilentVideoValidationContainer extends Container {
	defaultPort = 8080;
	sleepAfter = '10m';
	// The pinned tooling never needs outbound network access: source bytes
	// arrive on the validation request and the poster returns on its response.
	enableInternet = false;
}

export class SilentVideoValidationWorkflow extends WorkflowEntrypoint<ValidatorEnv, SilentVideoValidationParams> {
	async run(
		event: WorkflowEvent<SilentVideoValidationParams>,
		step: WorkflowStep,
	): Promise<SilentVideoValidationOutput> {
		const input = event.payload;
		const echo: ValidationBindingEcho = {
			operationId: input.operationId,
			idempotencyKey: input.idempotencyKey,
			sourceDigest: input.sourceDigest,
			factsDigest: input.factsDigest,
		};
		const staged = await step.do(
			'verify-staged-source',
			{ retries: { limit: 4, delay: '5 seconds', backoff: 'exponential' } },
			async () => {
				const head = await this.env.GRAPHICS_ASSET_STAGING.head(stagedSourceKey(input.operationId));
				if (!head)
					throw new Error('Staged silent-video source is not yet visible');
				return { byteLength: head.size };
			},
		);
		if (staged.byteLength !== input.sourceByteLength)
			return { ...echo, outcome: 'rejected', stage: 'metadata' };

		return await step.do(
			'validate-in-container',
			{
				retries: { limit: 3, delay: '15 seconds', backoff: 'exponential' },
				timeout: '15 minutes',
			},
			async () => {
				const source = await this.env.GRAPHICS_ASSET_STAGING.get(stagedSourceKey(input.operationId));
				if (!source)
					throw new NonRetryableError('Staged silent-video source disappeared before validation');
				const poster = posterFitDimensions(input.inspectedFacts);
				const container = this.env.SILENT_VIDEO_VALIDATION_CONTAINER.getByName(event.instanceId);
				await container.startAndWaitForPorts();
				const response = await container.fetch('http://silent-video-validation-container/validate', {
					method: 'POST',
					headers: {
						'content-type': input.sourceContentType,
						'x-validation-request': btoa(JSON.stringify({
							sourceDigest: input.sourceDigest,
							sourceByteLength: input.sourceByteLength,
							sourceContentType: input.sourceContentType,
							format: input.inspectedFacts.format,
							codec: input.inspectedFacts.codec,
							width: input.inspectedFacts.width,
							height: input.inspectedFacts.height,
							durationSeconds: input.inspectedFacts.durationSeconds,
							frameCount: input.inspectedFacts.frameCount,
							posterTimeSeconds: input.inspectedFacts.posterTimeSeconds,
							hasAlpha: input.inspectedFacts.hasAlpha,
							posterWidth: poster.width,
							posterHeight: poster.height,
							maxPosterBytes: MAX_SILENT_VIDEO_POSTER_BYTES,
						})),
					},
					body: source.body,
				});
				if (!response.ok)
					throw new Error(`Validation container failed with status ${response.status}`);
				const result = await response.json<ContainerValidationResponse>();
				if (result.outcome === 'rejected') {
					return {
						...echo,
						outcome: 'rejected' as const,
						stage: result.stage,
					};
				}
				const posterBytes = decodeBase64(result.posterBase64);
				if (
					posterBytes.byteLength <= 0
					|| posterBytes.byteLength > MAX_SILENT_VIDEO_POSTER_BYTES
					|| await sha256Hex(posterBytes) !== result.posterDigest
				) {
					throw new Error('Validation container returned an inconsistent poster envelope');
				}
				const posterKey = posterObjectKey(await sha256Hex(textEncoder.encode(input.idempotencyKey)));
				await this.env.GRAPHICS_ASSET_STAGING.put(posterKey, posterBytes, {
					httpMetadata: { contentType: 'image/png' },
				});
				return {
					...echo,
					outcome: 'accepted' as const,
					width: result.width,
					height: result.height,
					durationSeconds: result.durationSeconds,
					posterTimeSeconds: input.inspectedFacts.posterTimeSeconds,
					mutedInlinePlayback: result.mutedInlinePlayback,
					seeked: result.seeked,
					transparencyRendered: result.transparencyRendered,
					posterKey,
					posterDigest: result.posterDigest,
					posterByteLength: posterBytes.byteLength,
				};
			},
		);
	}
}

function retryableUnavailable(reason: string) {
	return Response.json({ error: reason }, {
		status: 503,
		headers: { 'retry-after': '5' },
	});
}

function bindingHeaders(echo: ValidationBindingEcho) {
	return {
		'x-stream-keepr-operation-id': echo.operationId,
		'x-stream-keepr-idempotency-key': echo.idempotencyKey,
		'x-stream-keepr-source-digest': echo.sourceDigest,
		'x-stream-keepr-facts-digest': echo.factsDigest,
	};
}

async function parseValidationRequest(request: Request): Promise<SilentVideoValidationParams | undefined> {
	let input: SilentVideoValidationParams;
	try {
		input = await request.json<SilentVideoValidationParams>();
	}
	catch {
		return undefined;
	}
	const facts = input?.inspectedFacts;
	if (
		typeof input?.operationId !== 'string'
		|| typeof input.idempotencyKey !== 'string'
		|| typeof input.sourceDigest !== 'string'
		|| !Number.isSafeInteger(input.sourceByteLength)
		|| input.sourceByteLength <= 0
		|| (input.sourceContentType !== 'video/mp4' && input.sourceContentType !== 'video/webm')
		|| typeof input.factsDigest !== 'string'
		|| typeof facts !== 'object'
		|| facts === null
	) {
		return undefined;
	}
	if (request.headers.get('idempotency-key') !== input.idempotencyKey)
		return undefined;
	const expectedKey = [
		'silent-video-playback-v1',
		input.operationId,
		input.sourceDigest,
		input.factsDigest,
	].join(':');
	if (input.idempotencyKey !== expectedKey)
		return undefined;
	if (
		facts.sha256 !== input.sourceDigest
		|| facts.byteLength !== input.sourceByteLength
		|| facts.canonicalMime !== input.sourceContentType
	) {
		return undefined;
	}
	const recomputedFactsDigest = await sha256Hex(
		textEncoder.encode(JSON.stringify(facts)),
	);
	if (recomputedFactsDigest !== input.factsDigest)
		return undefined;
	return input;
}

function outputMatchesRequest(
	output: SilentVideoValidationOutput,
	input: SilentVideoValidationParams,
) {
	return output.operationId === input.operationId
		&& output.idempotencyKey === input.idempotencyKey
		&& output.sourceDigest === input.sourceDigest
		&& output.factsDigest === input.factsDigest;
}

async function respondFromOutput(
	output: SilentVideoValidationOutput,
	input: SilentVideoValidationParams,
	env: ValidatorEnv,
) {
	if (!outputMatchesRequest(output, input))
		return retryableUnavailable('Validation output was not bound to this request');
	if (output.outcome === 'rejected') {
		return Response.json({ stage: output.stage }, {
			status: 422,
			headers: bindingHeaders(output),
		});
	}
	const poster = await env.GRAPHICS_ASSET_STAGING.get(output.posterKey);
	if (!poster || poster.size !== output.posterByteLength)
		return retryableUnavailable('Deterministic poster is not available yet');
	return new Response(poster.body, {
		status: 200,
		headers: {
			...bindingHeaders(output),
			'content-type': 'image/png',
			'content-length': String(output.posterByteLength),
			'x-stream-keepr-video-width': String(output.width),
			'x-stream-keepr-video-height': String(output.height),
			'x-stream-keepr-video-duration': String(output.durationSeconds),
			'x-stream-keepr-poster-time': String(output.posterTimeSeconds),
			'x-stream-keepr-muted-inline-playback': 'true',
			'x-stream-keepr-seeked': 'true',
			'x-stream-keepr-transparency-rendered': output.transparencyRendered ? 'true' : 'false',
			'x-stream-keepr-poster-digest': output.posterDigest,
		},
	});
}

export default {
	async fetch(request: Request, env: ValidatorEnv): Promise<Response> {
		const url = new URL(request.url);
		if (request.method !== 'POST' || url.pathname !== '/validate')
			return Response.json({ error: 'Not found' }, { status: 404 });
		const input = await parseValidationRequest(request);
		if (!input) {
			return Response.json({ stage: 'metadata' }, { status: 422 });
		}
		const validationId = await sha256Hex(textEncoder.encode(input.idempotencyKey));
		let instance: WorkflowInstance;
		try {
			instance = await env.SILENT_VIDEO_VALIDATION_WORKFLOW.get(validationId);
		}
		catch {
			try {
				instance = await env.SILENT_VIDEO_VALIDATION_WORKFLOW.create({
					id: validationId,
					params: input,
				});
			}
			catch {
				try {
					instance = await env.SILENT_VIDEO_VALIDATION_WORKFLOW.get(validationId);
				}
				catch {
					return retryableUnavailable('Validation workflow could not be started');
				}
			}
		}
		const deadline = Date.now() + RESULT_POLL_DEADLINE_MILLISECONDS;
		while (true) {
			let status: InstanceStatus;
			try {
				status = await instance.status();
			}
			catch {
				return retryableUnavailable('Validation workflow status is unavailable');
			}
			if (status.status === 'complete') {
				if (!status.output)
					return retryableUnavailable('Validation workflow completed without output');
				return await respondFromOutput(
					status.output as SilentVideoValidationOutput,
					input,
					env,
				);
			}
			if (status.status === 'errored' || status.status === 'terminated') {
				try {
					await instance.restart();
				}
				catch {
					// The next validation attempt reconnects and retries the restart.
				}
				return retryableUnavailable('Validation workflow is being restarted');
			}
			if (Date.now() >= deadline)
				return retryableUnavailable('Validation is still running');
			await new Promise(resolve => setTimeout(resolve, RESULT_POLL_INTERVAL_MILLISECONDS));
		}
	},
};
