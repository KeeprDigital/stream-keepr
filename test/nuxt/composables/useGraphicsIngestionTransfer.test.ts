import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const requests = () => requestsMadeTo(mockFetch);

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

		await expect(useGraphicsIngestionTransfer().transfer(
			operation(),
			sourceOfByteLength(GRAPHICS_MULTIPART_PART_BYTES + 1),
		)).rejects.toThrow('Connection reset');

		expect(requests().filter(request => request.endsWith('/multipart/parts/2')))
			.toHaveLength(3);
		// A transfer that never finished sending must not be completed.
		expect(requests()).not.toContain(`POST ${ingestion}/operation-1/multipart/complete`);
	});

	/**
	 * A part refused for want of an author is not a lost part. The graphics author
	 * session that owns this operation has lapsed, every remaining attempt will be
	 * refused for the same reason, and the operation itself is already unreachable
	 * — so the transfer stops, and says what happened rather than repeating the
	 * status code its caller cannot act on.
	 */
	it('stops rather than retrying when the graphics author session has lapsed', async () => {
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
		)).rejects.toThrow('Your graphics author session has lapsed');

		expect(requests().filter(request => request.endsWith('/multipart/parts/2')))
			.toHaveLength(1);
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

		expect(requests().filter(request => request.endsWith('/multipart/parts/2')))
			.toHaveLength(1);
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

		await expect(useGraphicsIngestionTransfer().transfer(
			operation(),
			sourceOfByteLength(GRAPHICS_MULTIPART_PART_BYTES + 1),
		)).rejects.toThrow(`Refused with ${status}`);

		expect(requests().filter(request => request.endsWith('/multipart/parts/2')))
			.toHaveLength(3);
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
		)).rejects.toThrow('Your graphics author session has lapsed');
	});
});
