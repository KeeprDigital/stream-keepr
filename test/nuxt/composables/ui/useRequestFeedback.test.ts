import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transportFailure } from '~~/test/helpers/transportFailure';

const mockToast = { add: vi.fn() };

mockNuxtImport('useToast', () => () => mockToast);

describe('useRequestFeedback', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns successful data and shows a configured success toast', async () => {
		const loading = ref(false);
		const { runRequest } = useRequestFeedback();

		const result = await runRequest(async () => ({ id: 7 }), {
			loadingRef: loading,
			success: result => ({
				title: 'Saved',
				description: `Saved ${result.id}`,
				color: 'success',
			}),
		});

		expect(result).toEqual({ id: 7 });
		expect(loading.value).toBe(false);
		expect(mockToast.add).toHaveBeenCalledWith({
			title: 'Saved',
			description: 'Saved 7',
			color: 'success',
		});
	});

	it('normalizes thrown Error instances for error toasts and refs', async () => {
		const errorRef = ref<string | null>('previous');
		const { runRequest } = useRequestFeedback();

		const result = await runRequest(async () => {
			throw new Error('Plain failure');
		}, {
			errorRef,
			error: ({ message }) => ({
				title: 'Failed',
				description: message,
				color: 'error',
			}),
		});

		expect(result).toBeNull();
		expect(errorRef.value).toBe('Plain failure');
		expect(mockToast.add).toHaveBeenCalledWith({
			title: 'Failed',
			description: 'Plain failure',
			color: 'error',
		});
	});

	it('prefers $fetch response data messages over wrapper messages', async () => {
		const { runRequest } = useRequestFeedback();

		await runRequest(async () => {
			throw transportFailure({ status: 400, body: { message: 'Server validation failed' } });
		}, {
			error: ({ message }) => ({
				title: 'Failed',
				description: message,
				color: 'error',
			}),
		});

		expect(mockToast.add).toHaveBeenCalledWith({
			title: 'Failed',
			description: 'Server validation failed',
			color: 'error',
		});
	});

	/**
	 * What a failed request is allowed to quote.
	 *
	 * Every one of these goes through `runRequest`'s catch, because that is the only way
	 * a caller meets `getErrorMessage`: the failure it caught becomes `failure.message`,
	 * and fifty-eight call sites turn that into a toast, an `errorRef`, or a field-level
	 * save error. The rule is `failureSentence`'s (#245): a sub-500 body is the authority
	 * answering this request and may be quoted; a 5xx body has had its prose replaced with
	 * a placeholder on the way out and may not (#271).
	 */
	describe('getErrorMessage', () => {
		async function reportedMessage(failure: unknown): Promise<string | null> {
			const errorRef = ref<string | null>(null);
			const { runRequest } = useRequestFeedback();

			await runRequest(async () => {
				throw failure;
			}, { errorRef, error: false });

			return errorRef.value;
		}

		it('quotes the sentence a refusal wrote about the request', async () => {
			const reported = await reportedMessage(transportFailure({
				status: 403,
				body: { message: 'This Event belongs to another installation' },
				request: `[GET] "/api/events/1"`,
			}));

			expect(reported).toBe('This Event belongs to another installation');
		});

		it('quotes a refusal body that named its prose statusMessage', async () => {
			const reported = await reportedMessage(transportFailure({
				status: 409,
				body: { statusMessage: 'The round has already been paired' },
			}));

			expect(reported).toBe('The round has already been paired');
		});

		it('quotes a refusal body that named its prose error', async () => {
			const reported = await reportedMessage(transportFailure({
				status: 422,
				body: { error: 'Deck list has no mainboard' },
			}));

			expect(reported).toBe('Deck list has no mainboard');
		});

		it('falls back to the reason phrase when a refusal wrote no prose', async () => {
			const reported = await reportedMessage(transportFailure({ status: 409 }));

			expect(reported).toBe('Conflict');
		});

		it('shows the transport line rather than a sanitized 5xx body', async () => {
			const reported = await reportedMessage(transportFailure({
				status: 500,
				body: { message: 'Internal Server Error' },
				request: `[POST] "/api/events/1/rounds"`,
			}));

			expect(reported).toBe('[POST] "/api/events/1/rounds": 500 Internal Server Error');
		});

		/**
		 * The distinguisher. A 5xx body that is *not* the placeholder still may not be
		 * quoted — an unmapped internal detail is machinery whatever it says, and reading
		 * it back would put a stack-shaped string in front of an operator as though the
		 * authority had written it about the show.
		 */
		it('never quotes an unsanitized 5xx body detail', async () => {
			const reported = await reportedMessage(transportFailure({
				status: 500,
				body: { message: 'D1_ERROR: no such table: rounds' },
				request: `[POST] "/api/events/1/rounds"`,
			}));

			expect(reported).not.toContain('D1_ERROR');
			expect(reported).toBe('[POST] "/api/events/1/rounds": 500 Internal Server Error');
		});

		/**
		 * The exclusion #286 made, at the seam fifty-eight call sites read. The families
		 * `mapPublicNitroError` spares the sanitizer name a deployment fault rather than a
		 * fact about the show, and are the only 5xx an operator can act on — so the refusal
		 * above must not reach them. Rotating a Screen's asset access raises one for real.
		 */
		it('quotes a 5xx whose prose the server preserved through sanitizing', async () => {
			const reported = await reportedMessage(transportFailure({
				status: 503,
				body: {
					message: 'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY is not set, '
						+ 'so Screen Output asset capabilities are unavailable',
				},
				request: `[POST] "/api/events/1/screens/1/asset-capability"`,
			}));

			expect(reported).toBe(
				'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY is not set, '
				+ 'so Screen Output asset capabilities are unavailable',
			);
		});

		/**
		 * And the other direction: a 503 is not itself evidence of a preserved message.
		 * `requireGraphicsAuthorSession` raises one whose cause matches no mapper branch,
		 * and it reaches a client carrying the placeholder written over it.
		 */
		it('still shows the transport line for a 503 the sanitizer got to', async () => {
			const reported = await reportedMessage(transportFailure({
				status: 503,
				body: { message: 'Internal Server Error', statusMessage: 'Internal Server Error' },
				request: `[GET] "/api/graphics-assets"`,
			}));

			expect(reported).toBe('[GET] "/api/graphics-assets": 503 Service Unavailable');
		});

		it('does not quote a 5xx reason phrase either', async () => {
			const reported = await reportedMessage(transportFailure({
				status: 503,
				request: `[GET] "/api/events"`,
			}));

			expect(reported).toBe('[GET] "/api/events": 503 Service Unavailable');
		});

		it('reads the boundary at 500, not above it', async () => {
			const reported = await reportedMessage(transportFailure({
				status: 499,
				statusText: 'Client Closed Request',
				body: { message: 'The operator navigated away' },
			}));

			expect(reported).toBe('The operator navigated away');
		});
	});

	it('treats success false responses as failures and uses their error message', async () => {
		const onFailure = vi.fn();
		const { runRequest } = useRequestFeedback();

		const result = await runRequest(async () => ({
			success: false,
			error: 'Sync failed',
		}), {
			onFailure,
			error: ({ message }) => ({
				title: 'Sync Failed',
				description: message,
				color: 'error',
			}),
		});

		expect(result).toBeNull();
		expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
			message: 'Sync failed',
			result: { success: false, error: 'Sync failed' },
		}));
		expect(mockToast.add).toHaveBeenCalledWith({
			title: 'Sync Failed',
			description: 'Sync failed',
			color: 'error',
		});
	});

	it('treats null results as failures by default', async () => {
		const errorRef = ref<string | null>(null);
		const { runRequest } = useRequestFeedback();

		const result = await runRequest(async () => null, {
			errorRef,
			error: ({ message }) => ({
				title: 'Failed',
				description: message,
				color: 'error',
			}),
		});

		expect(result).toBeNull();
		expect(errorRef.value).toBe('Request failed');
		expect(mockToast.add).toHaveBeenCalledWith({
			title: 'Failed',
			description: 'Request failed',
			color: 'error',
		});
	});

	it('only applies callbacks and loading state from the latest keyed request', async () => {
		let resolveFirst!: (value: string) => void;
		const firstResult = new Promise<string>((resolve) => {
			resolveFirst = resolve;
		});
		const loading = ref(false);
		const onSuccess = vi.fn();
		const { runRequest } = useRequestFeedback();

		const first = runRequest(() => firstResult, {
			latestKey: 'metagame',
			loadingRef: loading,
			success: false,
			onSuccess,
		});
		const second = runRequest(async () => 'new', {
			latestKey: 'metagame',
			loadingRef: loading,
			success: false,
			onSuccess,
		});

		await second;
		resolveFirst('old');
		await first;

		expect(onSuccess).toHaveBeenCalledOnce();
		expect(onSuccess).toHaveBeenCalledWith('new');
		expect(loading.value).toBe(false);
	});
});
