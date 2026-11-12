import type { H3Event } from 'h3';
import type { GraphicAssetId, GraphicsAssetEvidenceReading } from '~~/shared/types/graphicsAsset';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '~~/server/db';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { replacementPng } from '~~/test/helpers/graphicsFixtures';
import { createTestGraphicsLibrary, ingestImage, publishedRevision } from '~~/test/helpers/graphicsLibrary';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The Evidence Ledger as a Graphics Administrator queries it: the address names one
// subject as a kind and an identity, and the route reads that pair as one filter or
// refuses half of it. Only the guard and byte stores are faked.

const harness = await createSqliteD1Harness();
const context = createTestGraphicsLibrary({
	catalogue: createD1GraphicsAssetCatalogue(harness.database),
	identityPrefix: 'evidence',
});
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', async importOriginal => ({
	...await importOriginal<object>(),
	db,
}));
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => context.library,
}));
vi.doMock('~~/server/modules/graphics-administrator', () => ({
	requireGraphicsAdministrator: async () => {},
}));
vi.doMock('~~/server/utils/auth', () => ({
	optionalUserId: async () => undefined,
}));

interface StubEvent { query: Record<string, string> }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedQuery', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.query));
vi.stubGlobal('setResponseHeader', () => {});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

type Handler = (event: H3Event) => Promise<GraphicsAssetEvidenceReading>;
const readEvidence = (await import('~~/server/api/admin/graphics-assets/evidence.get')).default as unknown as Handler;

async function evidence(query: Record<string, string> = {}) {
	const request: StubEvent = { query };
	return await readEvidence(stubH3Event({ ...request }));
}

/** A Graphic Asset the ledger holds entries against: Trashed, then purged early. */
async function purgedAsset(name: string, bytes?: Uint8Array): Promise<GraphicAssetId> {
	const { assetId } = publishedRevision(await ingestImage(context, { idempotencyKey: name, name, bytes }));
	await context.library.trashGraphicAsset({ assetId });
	await context.library.purgeTrashedGraphicAsset({
		assetId,
		actor: 'graphics-administrator',
		confirmation: 'purge-now',
	});
	return assetId;
}

let asked: GraphicAssetId;
let other: GraphicAssetId;

beforeAll(async () => {
	asked = await purgedAsset('asked');
	other = await purgedAsset('other', replacementPng);
});

afterAll(async () => await harness.close());

describe('the Evidence Ledger read for one subject', () => {
	it('answers only the entries recorded against the subject the address names', async () => {
		const { entries } = await evidence({ subjectKind: 'graphic-asset', subjectId: asked });

		expect(entries).not.toHaveLength(0);
		expect(entries.map(entry => entry.subject)).toEqual(
			entries.map(() => ({ kind: 'graphic-asset', id: asked })),
		);
		// The ledger holds the other subject's entries too, so the address narrowed the read.
		const everything = await evidence();
		expect(everything.entries.some(entry => entry.subject.id === other)).toBe(true);
	});

	// Half a subject would silently widen the read to every subject, so it is refused instead.
	it.each<{ half: string; query: Record<string, string> }>([
		{
			half: 'a kind without an identity',
			query: { subjectKind: 'graphic-asset' },
		},
		{
			half: 'an identity without a kind',
			query: { subjectId: 'evidence-1' },
		},
	])('refuses $half', async ({ query }) => {
		await expect(evidence(query)).rejects.toMatchObject({
			name: 'ZodError',
			issues: [
				expect.objectContaining({ message: 'A subject filter needs both a subject kind and a subject identity' }),
			],
		});
	});
});
