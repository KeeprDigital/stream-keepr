import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GRAPHICS_MULTIPART_PART_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';
import { requestsMadeTo, sourceOfByteLength } from '~~/test/helpers/ingestionTransferRequests';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => undefined);

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
});
