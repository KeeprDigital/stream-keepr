import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

/**
 * A busy validation Container is retried, never read as a verdict (#698).
 *
 * The Container answers an overlapping validation 409
 * (`silentVideoValidationContainer.test.ts`). This drives the Workflow's own
 * `run` with a step that retries the way Workflows does, against a Container
 * stand-in answering what the real one answers, and checks the busy answer
 * neither settles the validation nor becomes a rejection of the video.
 */

const { NonRetryableError } = vi.hoisted(() => ({
	NonRetryableError: class NonRetryableError extends Error {},
}));

vi.mock('cloudflare:workers', () => ({
	WorkflowEntrypoint: class {
		env: unknown;
		constructor(_context: unknown, env: unknown) {
			this.env = env;
		}
	},
}));
vi.mock('cloudflare:workflows', () => ({ NonRetryableError }));
vi.mock('@cloudflare/containers', () => ({ Container: class {} }));

interface ValidationOutput {
	outcome: 'accepted' | 'rejected';
	stage?: string;
}

interface WorkflowModule {
	SilentVideoValidationWorkflow: new (context: unknown, env: unknown) => {
		run: (event: unknown, step: unknown) => Promise<ValidationOutput>;
	};
}

// Loaded by a computed path: the validator is its own TypeScript program
// (`workers/silent-video-validator/tsconfig.json`), typed by its own bindings,
// so the test program must not compile it under the app's.
const WORKFLOW_MODULE = '../../../workers/silent-video-validator/src/index.ts';

interface Fixture {
	base64: string;
	facts: { sha256: string; byteLength: number; canonicalMime: string };
}

const fixtures = JSON.parse(await readFile(
	new URL('../../../scripts/silent-video-validator-fixtures.json', import.meta.url),
	'utf8',
)) as Record<string, Fixture>;

const BUSY = () => Response.json({ error: 'validation already in progress' }, { status: 409 });

function validationParams() {
	const { facts } = fixtures.vp9Webm!;
	const operationId = 'operation-698';
	const factsDigest = createHash('sha256').update(JSON.stringify(facts)).digest('hex');
	return {
		operationId,
		idempotencyKey: ['silent-video-playback-v1', operationId, facts.sha256, factsDigest].join(':'),
		sourceDigest: facts.sha256,
		sourceByteLength: facts.byteLength,
		sourceContentType: facts.canonicalMime,
		factsDigest,
		inspectedFacts: facts,
	};
}

/** A step that retries a thrown attempt up to its limit, as Workflows does. */
function retryingStep() {
	const failures: { step: string; error: unknown }[] = [];
	return {
		failures,
		async do(name: string, config: { retries?: { limit: number } }, attempt: () => Promise<unknown>) {
			for (let tried = 0; ; tried++) {
				try {
					return await attempt();
				}
				catch (error) {
					failures.push({ step: name, error });
					if (error instanceof NonRetryableError || tried >= (config.retries?.limit ?? 0))
						throw error;
				}
			}
		},
	};
}

/** The validator's bindings, its Container answering `answers` in turn. */
function validatorEnv(answers: (() => Response)[]) {
	const source = Buffer.from(fixtures.vp9Webm!.base64, 'base64');
	const containerRequests: string[] = [];
	return {
		containerRequests,
		env: {
			GRAPHICS_ASSET_STAGING: {
				head: async () => ({ size: source.byteLength }),
				get: async () => ({ body: source }),
				put: async () => undefined,
			},
			SILENT_VIDEO_VALIDATION_CONTAINER: {
				getByName: () => ({
					startAndWaitForPorts: async () => undefined,
					fetch: async (url: string) => {
						containerRequests.push(url);
						const answer = answers.shift();
						if (!answer)
							throw new Error('no answer left');
						return answer();
					},
				}),
			},
		},
	};
}

async function runWorkflow(answers: (() => Response)[]) {
	const { SilentVideoValidationWorkflow } = await import(/* @vite-ignore */ WORKFLOW_MODULE) as WorkflowModule;
	const { env, containerRequests } = validatorEnv(answers);
	const step = retryingStep();
	const workflow = new SilentVideoValidationWorkflow({}, env);
	const outcome = workflow.run({ payload: validationParams(), instanceId: '00000000aa' }, step);
	return { outcome, step, containerRequests };
}

describe('silent-video validation Workflow and a busy Container', () => {
	it('retries a busy answer and settles on the validation that was admitted', async () => {
		const { outcome, step, containerRequests } = await runWorkflow([
			BUSY,
			() => Response.json({ outcome: 'rejected', stage: 'playback', detail: 'no frames' }),
		]);
		await expect(outcome).resolves.toMatchObject({ outcome: 'rejected', stage: 'playback' });
		expect(containerRequests).toHaveLength(2);
		expect(step.failures).toHaveLength(1);
		expect(step.failures[0]!.step).toBe('validate-in-container');
		expect(step.failures[0]!.error).not.toBeInstanceOf(NonRetryableError);
	});

	it('leaves a validation that is busy on every attempt unsettled, not rejected', async () => {
		const { outcome, step } = await runWorkflow(Array.from<() => Response>({ length: 6 }).fill(BUSY));
		await expect(outcome).rejects.toThrow('Validation container failed with status 409');
		expect(step.failures).toHaveLength(6);
		expect(step.failures.every(({ error }) => !(error instanceof NonRetryableError))).toBe(true);
	});
});
