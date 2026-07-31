import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GRAPHICS_MULTIPART_PART_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';
import { fileOfByteLength, requestsMadeTo } from '~~/test/helpers/ingestionTransferRequests';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => undefined);

const ingestion = '/api/graphics-assets/ingestion-operations';

const requests = () => requestsMadeTo(mockFetch);

/**
 * Both Template Package kinds import through one Graphics Ingestion Operation on
 * the Graphics Asset Library's own path, so what is true of a `.skgraphic` here is
 * true of a `.sklayout` for the same reason. Stating the rule once over both is
 * what keeps them from drifting apart.
 */
const packageKinds = [
	{
		extension: '.skgraphic',
		repository: () => useBroadcastGraphicTemplateRepository(),
	},
	{
		extension: '.sklayout',
		repository: () => useFeatureMatchLayoutTemplateRepository(),
	},
] as const;

describe.each(packageKinds)('importing a $extension Template Package', ({ extension, repository }) => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch.mockImplementation(async (path: string) => {
			if (path.endsWith('/multipart')) {
				return {
					id: 'operation-1',
					transfer: {
						method: 'multipart',
						partByteLength: GRAPHICS_MULTIPART_PART_BYTES,
						maximumConcurrentParts: 3,
						maximumPartAttempts: 3,
						partCount: 2,
						cleanupPending: false,
						completedParts: [],
					},
				} as unknown as GraphicsIngestionOperation;
			}
			return { id: 'operation-1', stage: 'awaiting-installation' } as GraphicsIngestionOperation;
		});
	});

	it('declares the archive as a Template Package rather than as one Graphic Asset', async () => {
		const file = fileOfByteLength(`lower-third${extension}`, 2048);

		await repository().receivePackage(file);

		expect(mockFetch).toHaveBeenNthCalledWith(1, ingestion, expect.objectContaining({
			method: 'POST',
			body: expect.objectContaining({
				source: 'template-package',
				sourceFileName: `lower-third${extension}`,
				declaredByteLength: 2048,
			}),
		}));
	});

	it('sends a package that fits one request as a single transfer', async () => {
		const file = fileOfByteLength(`lower-third${extension}`, GRAPHICS_MULTIPART_PART_BYTES);

		await repository().receivePackage(file);

		expect(requests()).toEqual([
			`POST ${ingestion}`,
			`PUT ${ingestion}/operation-1/content`,
		]);
	});

	/**
	 * The defect this pins: a package carrying whole Graphic Assets routinely
	 * outgrows a single request, and export will emit one far larger than this.
	 * An import that only knew how to PUT the archive in one piece refused every
	 * package the same installation was willing to produce.
	 */
	it('sends a package too long for one request as a resumable multipart transfer', async () => {
		const file = fileOfByteLength(`motion-overlay${extension}`, GRAPHICS_MULTIPART_PART_BYTES + 1);

		const received = await repository().receivePackage(file);

		expect(requests()).toEqual([
			`POST ${ingestion}`,
			`POST ${ingestion}/operation-1/multipart`,
			`PUT ${ingestion}/operation-1/multipart/parts/1`,
			`PUT ${ingestion}/operation-1/multipart/parts/2`,
			`POST ${ingestion}/operation-1/multipart/complete`,
		]);
		expect(received.stage).toBe('awaiting-installation');
	});
});
