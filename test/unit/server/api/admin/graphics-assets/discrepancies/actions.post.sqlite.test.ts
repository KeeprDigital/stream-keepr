import type { H3Event } from 'h3';
import type { GraphicsDiscrepancy } from '~~/shared/types/graphicsAsset';
import type { TestGraphicsLibrary } from '~~/test/helpers/graphicsLibrary';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { digestOf, pixelPng } from '~~/test/helpers/graphicsFixtures';
import {
	boundedBytes,
	canonicalIdentity,
	canonicalMetadata,
	createTestGraphicsLibrary,
	ingestImage,
	publishedRevision,
} from '~~/test/helpers/graphicsLibrary';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The byte-free actions a Graphics Administrator may take on one Graphics Discrepancy:
// each name the route offers reaches its own library action over the D1 catalogue,
// and a name it does not offer reaches none. Only the guard and byte stores are faked.

let harness: SqliteD1Harness;
let context: TestGraphicsLibrary;
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => context.library,
}));
vi.doMock('~~/server/modules/graphics-administrator', () => ({
	requireGraphicsAdministrator: async () => {},
}));
vi.doMock('~~/server/utils/auth', () => ({
	optionalUserId: async () => undefined,
}));

interface StubEvent {
	params: Record<string, string>;
	body: unknown;
}
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('readValidatedBody', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('getRouterParam', (event: StubEvent, name: string) => event.params[name]);
vi.stubGlobal('setResponseHeader', () => {});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

type Handler = (event: H3Event) => Promise<unknown>;
const act = (await import('~~/server/api/admin/graphics-assets/discrepancies/[discrepancyId]/actions.post')).default as unknown as Handler;

async function takeAction(discrepancy: GraphicsDiscrepancy, action: string) {
	const request: StubEvent = {
		params: { discrepancyId: discrepancy.id },
		body: { action },
	};
	return await act(stubH3Event({ ...request }));
}

async function openDiscrepancy(kind: GraphicsDiscrepancy['kind']) {
	const { discrepancies } = await context.library.getReconciliationOverview();
	const found = discrepancies.find(discrepancy => discrepancy.kind === kind);
	if (!found)
		throw new Error(`No open ${kind} discrepancy was recorded`);
	return found;
}

/**
 * Content that went missing and came back altered behind metadata that still agrees:
 * a recheck's head request sees agreement, and only a full re-hash sees the change.
 */
async function contentReturnedAltered() {
	await ingestImage(context, { idempotencyKey: 'altered', name: 'Altered' });
	const identity = canonicalIdentity(digestOf(pixelPng));
	await context.canonical.delete(identity);
	await context.library.runGraphicsReconciliation();
	const altered = Uint8Array.from(pixelPng);
	altered[altered.length - 20] = altered[altered.length - 20]! ^ 0xFF;
	await context.canonical.createImmutable({
		identity,
		bytes: boundedBytes(altered),
		metadata: canonicalMetadata(digestOf(pixelPng)),
	});
	return await openDiscrepancy('unavailable-content');
}

/** A thumbnail whose bytes are gone while its source revision is intact. */
async function thumbnailMissing() {
	const { revisionId } = publishedRevision(
		await ingestImage(context, { idempotencyKey: 'thumbnail', name: 'Thumbnail' }),
	);
	const derivative = await harness.client.execute({
		sql: 'SELECT content_digest FROM graphics_derivatives WHERE source_revision_id = ?',
		args: [revisionId],
	});
	await context.canonical.delete(canonicalIdentity(String(derivative.rows[0]?.content_digest)));
	await context.library.runGraphicsReconciliation();
	return await openDiscrepancy('missing-derivative');
}

beforeEach(async () => {
	harness = await createSqliteD1Harness();
	context = createTestGraphicsLibrary({
		catalogue: createD1GraphicsAssetCatalogue(harness.database),
		identityPrefix: 'discrepancy',
	});
});

afterEach(async () => await harness.close());

describe('an action on one Graphics Discrepancy', () => {
	it.each([
		{
			action: 'recheck',
			discrepancy: contentReturnedAltered,
			answered: { outcome: 'resolved', resolution: 'byte-store-agrees' },
		},
		// Deep Verification is the one action that re-hashes, so it alone refuses the altered bytes.
		{
			action: 'verify-stored-bytes',
			discrepancy: contentReturnedAltered,
			answered: { outcome: 'rejected', code: 'digest-mismatch' },
		},
		{
			action: 'regenerate-derivative',
			discrepancy: thumbnailMissing,
			answered: { outcome: 'resolved', resolution: 'derivative-regenerated' },
		},
	])('answers $action with what that action alone decides', async ({ action, discrepancy, answered }) => {
		const target = await discrepancy();

		expect(await takeAction(target, action)).toMatchObject(answered);
	});

	// Adopting an unexpected object is never offered, so its name is refused before any action runs.
	it('refuses an action it does not offer, leaving the Graphics Discrepancy as it was', async () => {
		const target = await contentReturnedAltered();

		await expect(takeAction(target, 'adopt-unexpected-object')).rejects.toMatchObject({ name: 'ZodError' });

		expect(await openDiscrepancy('unavailable-content')).toEqual(target);
	});
});
