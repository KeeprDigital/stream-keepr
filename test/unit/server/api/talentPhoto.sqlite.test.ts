import type { H3Event } from 'h3';
import type { GraphicAssetId, GraphicAssetRevisionId } from '~~/shared/types/graphicsAsset';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { graphicAssetReferences } from '~~/server/db/schema/graphicsAsset';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import {
	catalogueSelectability,
	createTestGraphicsLibrary,
	ingestImage,
	publishedRevision,
	seedGraphicAssetRevision,
} from '~~/test/helpers/graphicsLibrary';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Talent's photo is an ordinary Graphic Asset Reference (ADR-0067): an image the
// library can select, indexed `talent`/`photo`, holding Retire and Trash back while
// it stands, and released by clearing it, deleting the Talent, or deleting the Event.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
const published: { type: string; payload: any }[] = [];
vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async (_eventId: number, type: string, payload: unknown) => {
		published.push({ type, payload });
	},
	publishMessageStrict: async () => {},
	getOriginConnectionId: () => undefined,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: async () => {},
}));

const { inspectGraphicAssetRevisions, answeredBeforeRetirement } = catalogueSelectability(harness);
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({ inspectGraphicAssetRevisions }),
}));

interface StubEvent { params: Record<string, string>; body?: unknown }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('setResponseStatus', () => {});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; data?: unknown }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

type Handler = (event: H3Event) => Promise<any>;
const handler = (module: { default: unknown }) => module.default as Handler;
const createTalent = handler(await import('~~/server/api/events/[id]/talents/index.post'));
const updateTalent = handler(await import('~~/server/api/events/[id]/talents/[talentId]/index.patch'));
const deleteTalent = handler(await import('~~/server/api/events/[id]/talents/[talentId]/index.delete'));
const deleteEvent = handler(await import('~~/server/api/events/[id]/index.delete'));

function call(handler: Handler, params: Record<string, string | number>, body?: unknown) {
	return handler(stubH3Event({
		params: Object.fromEntries(Object.entries(params).map(([key, value]) => [
			key,
			String(value),
		])),
		body,
	}));
}

async function refusal(promise: Promise<unknown>) {
	return await promise.then(
		() => {
			throw new Error('The write was not refused');
		},
		(error: { statusCode?: number; message?: string }) => ({ statusCode: error.statusCode, message: error.message }),
	);
}

const context = createTestGraphicsLibrary({
	catalogue: createD1GraphicsAssetCatalogue(harness.database),
	start: '2026-11-04T00:00:00.000Z',
	identityPrefix: 'talent-photo',
});

interface Revision { assetId: GraphicAssetId; revisionId: GraphicAssetRevisionId }
let images = 0;
async function ingest(): Promise<Revision> {
	return publishedRevision(await ingestImage(context, { idempotencyKey: `image-${++images}`, initiatedBy: 'author' }));
}

let face: Revision;
let clip: Revision;

beforeAll(async () => {
	face = await seedGraphicAssetRevision(harness, 'font', 'face');
	clip = await seedGraphicAssetRevision(harness, 'silent-video', 'clip');
});

let portrait: Revision;
let other: Revision;
let eventId: number;

beforeEach(async () => {
	answeredBeforeRetirement.clear();
	published.length = 0;
	await db.delete(graphicAssetReferences);
	portrait = await ingest();
	other = await ingest();
	const [event] = await db.insert(schema.events)
		.values({ name: 'Finals', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	eventId = event!.id;
});

afterAll(async () => await harness.close());

const retire = (revision: Revision) => context.library.retireGraphicAsset({ assetId: revision.assetId, actor: 'author' });
const trash = (revision: Revision) => context.library.trashGraphicAsset({ assetId: revision.assetId, actor: 'author' });

async function talentReferences() {
	return (await db.select().from(graphicAssetReferences).where(eq(graphicAssetReferences.ownerKind, 'talent')))
		.map(row => ({
			assetId: row.assetId,
			revisionId: row.revisionId,
			ownerId: row.ownerId,
			ownerSlot: row.ownerSlot,
			eventId: row.eventId,
		}));
}

async function storedPhoto(talentId: number) {
	const [talent] = await db.select().from(schema.eventTalents).where(eq(schema.eventTalents.id, talentId));
	return talent?.photo;
}

describe('a Talent photo', () => {
	it.each([
		[
			'created with the Talent',
			async () => await call(createTalent, { id: eventId }, { name: 'Alice', photo: portrait }),
			'talent:created',
		],
		[
			'set on an existing Talent',
			async () => {
				const talent = await call(createTalent, { id: eventId }, { name: 'Alice' });
				published.length = 0;
				return await call(updateTalent, { id: eventId, talentId: talent.id }, { photo: portrait });
			},
			'talent:updated',
		],
	])('is stored, indexed as talent/photo, and announced when %s', async (_case, write, message) => {
		const talent = await write();

		expect(talent.photo).toEqual(portrait);
		expect(talent).not.toHaveProperty('graphicAssetReferenceVersion');
		expect(await storedPhoto(talent.id)).toEqual(portrait);
		expect(await talentReferences()).toEqual([
			{
				...portrait,
				ownerId: String(talent.id),
				ownerSlot: 'photo',
				eventId,
			},
		]);
		expect(published).toEqual([
			{
				type: message,
				payload: {
					talent: expect.objectContaining({ id: talent.id, photo: portrait }),
				},
			},
		]);
	});

	it('refuses Retire and Trash while a Talent references it, naming the Talent and its Event', async () => {
		const talent = await call(createTalent, { id: eventId }, { name: 'Alice', photo: portrait });

		for (const action of [retire, trash]) {
			expect(await action(portrait)).toMatchObject({
				outcome: 'in-use',
				usage: [
					expect.objectContaining({
						owner: expect.objectContaining({
							kind: 'talent',
							id: String(talent.id),
							name: 'Alice',
							slot: 'photo',
							eventId,
							eventName: 'Finals',
						}),
					}),
				],
			});
		}
	});

	it.each([
		[
			'clearing the photo',
			async (talentId: number) => {
				await call(updateTalent, { id: eventId, talentId }, { photo: null });
			},
		],
		[
			'replacing the photo',
			async (talentId: number) => {
				await call(updateTalent, { id: eventId, talentId }, { photo: other });
			},
		],
		[
			'deleting the Talent',
			async (talentId: number) => {
				await call(deleteTalent, { id: eventId, talentId });
			},
		],
		[
			'deleting the Event',
			async () => {
				await call(deleteEvent, { id: eventId });
			},
		],
	])('releases it on %s, so it retires and enters Trash', async (_case, release) => {
		const talent = await call(createTalent, { id: eventId }, { name: 'Alice', photo: portrait });

		await release(talent.id);

		expect((await retire(portrait)).outcome).toBe('retired');
		expect((await trash(portrait)).outcome).toBe('trashed');
	});

	it('writes the role beside the photo, on create and on update', async () => {
		const talent = await call(createTalent, { id: eventId }, { name: 'Alice', role: ' Host ', photo: portrait });
		expect(talent.role).toBe('Host');

		const updated = await call(updateTalent, { id: eventId, talentId: talent.id }, { role: 'Commentator', photo: other });
		expect(updated).toMatchObject({ role: 'Commentator', photo: other });
	});

	it('keeps the photo and its reference through an edit that does not name it', async () => {
		const talent = await call(createTalent, { id: eventId }, { name: 'Alice', photo: portrait });

		const renamed = await call(updateTalent, { id: eventId, talentId: talent.id }, { name: 'Alicia' });

		expect(renamed.photo).toEqual(portrait);
		expect(await talentReferences()).toEqual([
			{
				...portrait,
				ownerId: String(talent.id),
				ownerSlot: 'photo',
				eventId,
			},
		]);
	});

	it.each([
		[
			'a retired asset',
			async () => {
				await retire(other);
				return other;
			},
		],
		[
			'a revision that does not exist',
			async () => ({ assetId: other.assetId, revisionId: 'revision-invented' }),
		],
		[
			'a silent video',
			async () => clip,
		],
		[
			'a font',
			async () => face,
		],
	])('refuses a Talent naming %s, storing nothing', async (_case, photo) => {
		const value = await photo();
		const talent = await call(createTalent, { id: eventId }, { name: 'Alice', photo: portrait });

		const refusedCreate = await refusal(call(createTalent, { id: eventId }, { name: 'Bob', photo: value }));
		const refusedUpdate = await refusal(call(updateTalent, { id: eventId, talentId: talent.id }, { name: 'Alicia', photo: value }));

		for (const refused of [refusedCreate, refusedUpdate]) {
			expect(refused).toMatchObject({
				statusCode: 409,
				message: expect.stringContaining('photo'),
			});
		}
		expect((await db.select().from(schema.eventTalents).where(eq(schema.eventTalents.eventId, eventId)))
			.map(row => ({ name: row.name, photo: row.photo })))
			.toEqual([
				{ name: 'Alice', photo: portrait },
			]);
		expect(await talentReferences()).toEqual([
			{
				...portrait,
				ownerId: String(talent.id),
				ownerSlot: 'photo',
				eventId,
			},
		]);
	});

	it('refuses at the commit a photo whose asset was retired after the library answered', async () => {
		const talent = await call(createTalent, { id: eventId }, { name: 'Alice' });
		await retire(other);
		answeredBeforeRetirement.add(other.assetId);

		const refusedCreate = await refusal(call(createTalent, { id: eventId }, { name: 'Bob', photo: other }));
		const refusedUpdate = await refusal(call(updateTalent, { id: eventId, talentId: talent.id }, { photo: other }));

		for (const refused of [refusedCreate, refusedUpdate]) {
			expect(refused).toMatchObject({
				statusCode: 409,
				message: expect.stringContaining('stopped being selectable'),
			});
		}
		expect((await db.select().from(schema.eventTalents).where(eq(schema.eventTalents.eventId, eventId)))
			.map(row => ({ name: row.name, photo: row.photo })))
			.toEqual([
				{ name: 'Alice', photo: null },
			]);
		expect(await talentReferences()).toEqual([]);
	});
});
