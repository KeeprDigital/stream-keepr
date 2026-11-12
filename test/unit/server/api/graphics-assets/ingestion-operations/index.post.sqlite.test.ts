import type { H3Event } from 'h3';
import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createTestGraphicsLibrary } from '~~/test/helpers/graphicsLibrary';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { refusalFrom } from '~~/test/helpers/publicServerFailure';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Initiating a Graphics Ingestion Operation over the D1 catalogue: what a client is
// answered when the Graphics Staging Allowance admits it, and when it is full.
// Only the Session and the byte stores are faked.

const harness = await createSqliteD1Harness();
const { library } = createTestGraphicsLibrary({
	catalogue: createD1GraphicsAssetCatalogue(harness.database),
	identityPrefix: 'initiation',
});
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => library,
}));
vi.doMock('~~/server/utils/auth', () => ({
	requireUserId: async () => 'author-1',
	optionalUserId: async () => 'author-1',
}));

interface StubEvent {
	body: unknown;
	response: { status?: number };
}
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('readValidatedBody', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('setResponseStatus', (event: StubEvent, status: number) => {
	event.response.status = status;
});
vi.stubGlobal('setResponseHeader', () => {});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

type Handler = (event: H3Event) => Promise<unknown>;
const initiate = (await import('~~/server/api/graphics-assets/ingestion-operations/index.post')).default as unknown as Handler;

function initiation(idempotencyKey: string, declaredByteLength: number): StubEvent {
	return {
		body: {
			idempotencyKey,
			name: idempotencyKey,
			declaredByteLength,
		},
		response: {},
	};
}

/** Leaves exactly `availableBytes` of the Graphics Staging Allowance unclaimed. */
async function leaveStagingRoomFor(availableBytes: number) {
	const { canonical, staging } = await library.getCapacity();
	const stagingLimitBytes = staging.usedBytes + staging.reservedBytes + availableBytes;
	await library.updateCapacityLimits({
		canonicalLimitBytes: canonical.limitBytes,
		stagingLimitBytes,
	});
	return stagingLimitBytes;
}

afterAll(async () => await harness.close());

describe('initiating a Graphics Ingestion Operation', () => {
	it('answers 201 with an operation owned by the signed-in User when the allowance admits it', async () => {
		await leaveStagingRoomFor(68);
		const request = initiation('admitted', 68);

		const operation = await initiate(stubH3Event({ ...request })) as GraphicsIngestionOperation;

		expect(request.response.status).toBe(201);
		expect(operation).toMatchObject({
			stage: 'created',
			initiatedBy: 'author-1',
			declaredByteLength: 68,
		});
		expect((await library.getCapacity()).staging.reservedBytes).toBe(68);
	});

	// A client sizes its retry from these numbers, so they must survive the route and the 5xx mapper.
	it('answers 507 with the staging occupancy when the allowance is one byte short', async () => {
		const stagingLimitBytes = await leaveStagingRoomFor(67);
		const reservedBefore = (await library.getCapacity()).staging.reservedBytes;
		const request = initiation('refused', 68);

		const refusal = await refusalFrom(initiate(stubH3Event({ ...request })));

		expect(refusal).toMatchObject({
			statusCode: 507,
			statusMessage: 'Insufficient Storage',
			data: {
				resource: 'staging',
				limitBytes: stagingLimitBytes,
				requestedBytes: 68,
				availableBytes: 67,
			},
		});
		expect(request.response.status).toBeUndefined();
		expect((await library.getCapacity()).staging.reservedBytes).toBe(reservedBefore);
	});
});
