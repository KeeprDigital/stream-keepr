import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRAPHICS_MULTIPART_PART_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';
import { requestsMadeTo, sourceOfByteLength } from '~~/test/helpers/ingestionTransferRequests';

const { mockFetch, realtime } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
	realtime: { current: undefined as { connectionId: string } | undefined },
}));

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => realtime.current);

const ingestion = '/api/graphics-assets/ingestion-operations';

function operation(overrides: Partial<GraphicsIngestionOperation> = {}) {
	return { id: 'operation-1', stage: 'created', ...overrides } as GraphicsIngestionOperation;
}

/**
 * The transfer facts the library states when it starts a resumable transfer.
 * `completedParts` is what makes resuming possible, so it is a parameter here
 * rather than always empty.
 */
function transferFacts(partCount: number, heldPartNumbers: number[] = []) {
	return {
		method: 'multipart' as const,
		partByteLength: GRAPHICS_MULTIPART_PART_BYTES,
		maximumConcurrentParts: 3,
		maximumPartAttempts: 3,
		partCount,
		cleanupPending: false,
		completedParts: heldPartNumbers.map(partNumber => ({
			partNumber,
			partIdentity: `operation-1:${partNumber}` as never,
			byteLength: GRAPHICS_MULTIPART_PART_BYTES,
		})),
	};
}

/**
 * The library's transient refusal as `$fetch` rejects with it: a 503 whose
 * response names, in `retry-after`, how long to wait before asking again.
 */
function unavailable(retryAfter: string) {
	return Object.assign(new Error('Service Unavailable'), {
		statusCode: 503,
		response: { headers: new Headers({ 'retry-after': retryAfter }) },
	});
}

const requests = () => requestsMadeTo(mockFetch);

/**
 * Runs a transfer that waits between part attempts without spending real time
 * on the waits: fake timers are installed before it starts and run until it
 * settles.
 */
async function throughEveryWait<T>(start: () => Promise<T>): Promise<T> {
	vi.useFakeTimers();
	try {
		const settled = start().then(
			value => ({ value }),
			(error: unknown) => ({ error }),
		);
		await vi.runAllTimersAsync();
		const outcome = await settled;
		if ('error' in outcome)
			throw outcome.error;
		return outcome.value;
	}
	finally {
		vi.useRealTimers();
	}
}

/**
 * A two-part transfer whose part 2 is refused with `failure` the first
 * `refusals` times it is sent, and accepted after.
 */
function refusingPartTwo(refusals: number, failure: () => unknown) {
	let refused = 0;
	mockFetch.mockImplementation(async (path: string) => {
		if (path.endsWith('/multipart'))
			return operation({ transfer: transferFacts(2) });
		if (path.endsWith('/multipart/parts/2') && refused++ < refusals)
			throw failure();
		return operation({ stage: 'completed' });
	});
}

/** How many times part 2 has been sent so far. */
function partTwoSends(): number {
	return requests().filter(request => request.endsWith('/multipart/parts/2')).length;
}

/** The length of each part sent, in the order it was sent. */
function partSizes(): number[] {
	return mockFetch.mock.calls
		.filter(call => String(call[0]).includes('/multipart/parts/'))
		.map(call => (call[1] as { body: Blob }).body.size);
}

describe('useGraphicsIngestionTransfer', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		realtime.current = undefined;
	});

	/**
	 * The app-wide origin-suppression convention, adopted for every caller of
	 * this transfer by #150's ruling: an uploader names its own realtime
	 * connection so it is suppressed from its own echo.
	 */
	it('names the realtime connection on what it sends, so the uploader is suppressed from its own echo', async () => {
		realtime.current = { connectionId: 'connection-9' };
		mockFetch.mockResolvedValue(operation({ stage: 'completed' }));

		await useGraphicsIngestionTransfer().transfer(
			operation(),
			sourceOfByteLength(GRAPHICS_MULTIPART_PART_BYTES),
		);

		expect(mockFetch).toHaveBeenCalledWith(
			`${ingestion}/operation-1/content`,
			expect.objectContaining({
				headers: { 'x-realtime-connection-id': 'connection-9' },
			}),
		);
	});

	it('sends a source that fits one request as a single transfer', async () => {
		const completed = operation({ stage: 'completed' });
		mockFetch.mockResolvedValue(completed);

		const result = await useGraphicsIngestionTransfer().transfer(
			operation(),
			sourceOfByteLength(GRAPHICS_MULTIPART_PART_BYTES),
		);

		expect(result).toBe(completed);
		expect(requests()).toEqual([`PUT ${ingestion}/operation-1/content`]);
	});

	it('sends a source longer than one request may carry as a resumable multipart transfer', async () => {
		const completed = operation({ stage: 'completed' });
		mockFetch.mockImplementation(async (path: string) => {
			if (path.endsWith('/multipart'))
				return operation({ transfer: transferFacts(2) });
			if (path.endsWith('/multipart/complete'))
				return completed;
			return operation();
		});

		const result = await useGraphicsIngestionTransfer().transfer(
			operation(),
			sourceOfByteLength(GRAPHICS_MULTIPART_PART_BYTES + 1),
		);

		expect(result).toBe(completed);
		expect(requests()).toEqual([
			`POST ${ingestion}/operation-1/multipart`,
			`PUT ${ingestion}/operation-1/multipart/parts/1`,
			`PUT ${ingestion}/operation-1/multipart/parts/2`,
			`POST ${ingestion}/operation-1/multipart/complete`,
		]);
		// The last part carries only what is left, not a whole part's worth.
		expect(partSizes()).toEqual([GRAPHICS_MULTIPART_PART_BYTES, 1]);
	});

	it('sends only the parts the library does not already hold', async () => {
		mockFetch.mockImplementation(async (path: string) => {
			if (path.endsWith('/multipart'))
				return operation({ transfer: transferFacts(2, [1]) });
			return operation();
		});

		await useGraphicsIngestionTransfer().transfer(
			operation(),
			sourceOfByteLength(GRAPHICS_MULTIPART_PART_BYTES + 1),
		);

		expect(requests()).toEqual([
			`POST ${ingestion}/operation-1/multipart`,
			`PUT ${ingestion}/operation-1/multipart/parts/2`,
			`POST ${ingestion}/operation-1/multipart/complete`,
		]);
		// Part 2 carries part 2's bytes: an outstanding part is sliced by which part
		// it is, not by its position in what is left to send.
		expect(partSizes()).toEqual([1]);
	});

	it('re-sends a part the transport lost, and gives up once its attempts are spent', async () => {
		mockFetch.mockImplementation(async (path: string) => {
			if (path.endsWith('/multipart'))
				return operation({ transfer: transferFacts(2) });
			if (path.endsWith('/multipart/parts/2'))
				throw new Error('Connection reset');
			return operation();
		});

		await expect(throughEveryWait(() => useGraphicsIngestionTransfer().transfer(
			operation(),
			sourceOfByteLength(GRAPHICS_MULTIPART_PART_BYTES + 1),
		))).rejects.toThrow('Connection reset');

		expect(partTwoSends()).toBe(3);
		// A transfer that never finished sending must not be completed.
		expect(requests()).not.toContain(`POST ${ingestion}/operation-1/multipart/complete`);
	});

	/**
	 * A part refused for want of an author is not a lost part. The graphics author
	 * session this operation was started in has ended, every remaining attempt will be
	 * refused for the same reason, and the operation itself is already unreachable
	 * — so the transfer stops, and says what happened rather than repeating the
	 * status code its caller cannot act on.
	 */
	it('stops rather than retrying when the browser is no longer signed in', async () => {
		mockFetch.mockImplementation(async (path: string) => {
			if (path.endsWith('/multipart'))
				return operation({ transfer: transferFacts(2) });
			if (path.endsWith('/multipart/parts/2'))
				throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
			return operation();
		});

		await expect(useGraphicsIngestionTransfer().transfer(
			operation(),
			sourceOfByteLength(GRAPHICS_MULTIPART_PART_BYTES + 1),
		)).rejects.toThrow('This browser is no longer signed in');

		expect(partTwoSends()).toBe(1);
		expect(requests()).not.toContain(`POST ${ingestion}/operation-1/multipart/complete`);
	});

	/**
	 * The one retry policy, decided on #150 for every caller of this transfer:
	 * network failures, 408, 429, and 5xx retry within the attempt budget;
	 * every other 4xx is a refusal that re-sending the same bytes cannot
	 * change, so it fails immediately without consuming attempts.
	 */
	it('fails a part immediately on a refusal a retry cannot change', async () => {
		mockFetch.mockImplementation(async (path: string) => {
			if (path.endsWith('/multipart'))
				return operation({ transfer: transferFacts(2) });
			if (path.endsWith('/multipart/parts/2'))
				throw Object.assign(new Error('Payload Too Large'), { statusCode: 413 });
			return operation();
		});

		await expect(useGraphicsIngestionTransfer().transfer(
			operation(),
			sourceOfByteLength(GRAPHICS_MULTIPART_PART_BYTES + 1),
		)).rejects.toThrow('Payload Too Large');

		expect(partTwoSends()).toBe(1);
		expect(requests()).not.toContain(`POST ${ingestion}/operation-1/multipart/complete`);
	});

	it.each([408, 429, 503])('spends the attempt budget on a %i, which a retry can outlive', async (status) => {
		mockFetch.mockImplementation(async (path: string) => {
			if (path.endsWith('/multipart'))
				return operation({ transfer: transferFacts(2) });
			if (path.endsWith('/multipart/parts/2'))
				throw Object.assign(new Error(`Refused with ${status}`), { statusCode: status });
			return operation();
		});

		await expect(throughEveryWait(() => useGraphicsIngestionTransfer().transfer(
			operation(),
			sourceOfByteLength(GRAPHICS_MULTIPART_PART_BYTES + 1),
		))).rejects.toThrow(`Refused with ${status}`);

		expect(partTwoSends()).toBe(3);
	});

	/**
	 * The library counts a part's attempts itself (#639): a part re-sent the
	 * moment it failed spends the allowance a store blip of a second or two
	 * would have outlived. So a re-send waits first.
	 */
	describe('waiting before re-sending a part', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		const transferTwoParts = () => useGraphicsIngestionTransfer().transfer(
			operation(),
			sourceOfByteLength(GRAPHICS_MULTIPART_PART_BYTES + 1),
		);

		it('waits the interval the library names in retry-after', async () => {
			refusingPartTwo(1, () => unavailable('5'));

			const pending = transferTwoParts();

			await vi.advanceTimersByTimeAsync(4_999);
			expect(partTwoSends()).toBe(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(partTwoSends()).toBe(2);
			expect((await pending).stage).toBe('completed');
		});

		/**
		 * A failure that names no interval — a lost connection, a 503 that is not
		 * the library's — still gets one: each re-send of a part waits twice as
		 * long as the last, starting at a second.
		 */
		it('backs off when the failure names no interval', async () => {
			refusingPartTwo(2, () => new Error('Connection reset'));

			const pending = transferTwoParts();

			await vi.advanceTimersByTimeAsync(999);
			expect(partTwoSends()).toBe(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(partTwoSends()).toBe(2);
			await vi.advanceTimersByTimeAsync(1_999);
			expect(partTwoSends()).toBe(2);
			await vi.advanceTimersByTimeAsync(1);
			expect(partTwoSends()).toBe(3);
			expect((await pending).stage).toBe('completed');
		});

		/**
		 * An author watching a transfer is not served by one that sits silent for
		 * an hour because a response said so: each wait has a ceiling.
		 */
		it('waits no longer than thirty seconds, whatever retry-after asks', async () => {
			refusingPartTwo(1, () => unavailable('3600'));

			const pending = transferTwoParts();

			await vi.advanceTimersByTimeAsync(29_999);
			expect(partTwoSends()).toBe(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(partTwoSends()).toBe(2);
			expect((await pending).stage).toBe('completed');
		});
	});

	/**
	 * The page's per-part progress reporting (#150): every operation snapshot
	 * the transfer learns along the way — the started transfer and each
	 * verified part's checkpoint — reaches the caller, who owns presentation.
	 */
	it('reports the started transfer and each part checkpoint to its observer', async () => {
		mockFetch.mockImplementation(async (path: string) => {
			if (path.endsWith('/multipart'))
				return operation({ transfer: transferFacts(2), transferredByteLength: 0 });
			if (path.includes('/multipart/parts/1'))
				return operation({ transferredByteLength: GRAPHICS_MULTIPART_PART_BYTES });
			if (path.includes('/multipart/parts/2'))
				return operation({ transferredByteLength: GRAPHICS_MULTIPART_PART_BYTES + 1 });
			return operation({ stage: 'completed' });
		});
		const observed: number[] = [];

		await useGraphicsIngestionTransfer({
			onOperation: snapshot => observed.push(snapshot.transferredByteLength),
		}).transfer(
			operation(),
			sourceOfByteLength(GRAPHICS_MULTIPART_PART_BYTES + 1),
		);

		expect(observed).toEqual([0, GRAPHICS_MULTIPART_PART_BYTES, GRAPHICS_MULTIPART_PART_BYTES + 1]);
	});

	/**
	 * The single-request transfer produces no per-part checkpoints, so while the
	 * library is verifying the body the only source of progress is asking. The
	 * transfer owns that asking (#150): every 250ms it reads the operation and
	 * reports what it learns, and stops when the request settles.
	 */
	it('polls the operation while a single-request transfer is pending and reports what it learns', async () => {
		vi.useFakeTimers();
		try {
			let settle!: (operation: GraphicsIngestionOperation) => void;
			let polled = 0;
			mockFetch.mockImplementation((path: string, request?: { method?: string }) => {
				if (!request?.method)
					return Promise.resolve(operation({ transferredByteLength: ++polled }));
				return new Promise<GraphicsIngestionOperation>((resolve) => {
					settle = resolve;
				});
			});
			const observed: number[] = [];

			const pending = useGraphicsIngestionTransfer({
				onOperation: snapshot => observed.push(snapshot.transferredByteLength),
			}).transfer(operation(), sourceOfByteLength(1));

			await vi.advanceTimersByTimeAsync(600);
			settle(operation({ stage: 'completed' }));
			const result = await pending;
			const observedWhilePending = observed.length;
			await vi.advanceTimersByTimeAsync(600);

			expect(result.stage).toBe('completed');
			expect(observed).toEqual([1, 2]);
			// The poller stops with the request it was observing.
			expect(observed.length).toBe(observedWhilePending);
			expect(requests().filter(request => request === `GET ${ingestion}/operation-1`))
				.toHaveLength(2);
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('polls the operation while the multipart completion is pending', async () => {
		vi.useFakeTimers();
		try {
			let settle!: (operation: GraphicsIngestionOperation) => void;
			mockFetch.mockImplementation((path: string, request?: { method?: string }) => {
				if (path.endsWith('/multipart'))
					return Promise.resolve(operation({ transfer: transferFacts(1) }));
				if (path.endsWith('/multipart/complete')) {
					return new Promise<GraphicsIngestionOperation>((resolve) => {
						settle = resolve;
					});
				}
				if (!request?.method)
					return Promise.resolve(operation({ transferredByteLength: 42 }));
				return Promise.resolve(operation());
			});
			const observed: number[] = [];

			const pending = useGraphicsIngestionTransfer({
				onOperation: snapshot => observed.push(snapshot.transferredByteLength),
			}).transfer(operation(), sourceOfByteLength(GRAPHICS_MULTIPART_PART_BYTES + 1));

			await vi.advanceTimersByTimeAsync(300);
			settle(operation({ stage: 'completed' }));
			await pending;

			expect(observed).toContain(42);
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('says the same thing when a source that fits one request is refused', async () => {
		mockFetch.mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 }));

		await expect(useGraphicsIngestionTransfer().transfer(
			operation(),
			sourceOfByteLength(GRAPHICS_MULTIPART_PART_BYTES),
		)).rejects.toThrow('This browser is no longer signed in');
	});
});
