import type { H3Event } from 'h3';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { screenOutputAssetCapabilityDigest } from '~~/server/modules/screen-output-assets/capability';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The Screen lookup by slug over real SQL (ADR-0010): the route's own half of a Screen
// Output read. Who a capability or a Session admits is `screenOutputReads.sqlite.test.ts`'s;
// here, the slug names one Event's Screen and every refusal is one 404. Only the Session read is faked.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

/** Whether the request carries a Session, and how often one was asked about. */
let signedIn = false;
let sessionsAsked = 0;
vi.doMock('~~/server/utils/auth', () => ({
	optionalUserSession: async () => {
		sessionsAsked += 1;
		return signedIn
			? {
					user: { id: 'user-1' },
					session: { id: 'session-1' },
				}
			: null;
	},
}));

interface StubRequest { params: Record<string, string>; headers: Record<string, string> }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubRequest, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('getRequestHeader', (event: StubRequest, name: string) => event.headers[name]);
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

type Handler = (event: H3Event) => Promise<Record<string, unknown>>;
const readScreenBySlug = (await import('~~/server/api/screen-output/events/[id]/screens/slug/[slug].get')).default as unknown as Handler;

const CAPABILITY = 'a-screen-output-capability-token';

let eventId: number;
/** The Screen `programme` names, as stored. */
let programme: typeof schema.screens.$inferSelect;

async function stageEvent(name: string) {
	const [event] = await db.insert(schema.events)
		.values({ name, game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	return event!.id;
}

async function stageScreen(inEventId: number, slug: string, capability: string) {
	const [screen] = await db.insert(schema.screens)
		.values({
			eventId: inEventId,
			name: slug,
			slug,
			currentMode: 'card',
			assetCapabilitySeed: `seed-of-${slug}`,
			assetCapabilityDigest: await screenOutputAssetCapabilityDigest(capability),
		})
		.returning();
	return screen!;
}

function read(slug: string, bearer?: string) {
	return readScreenBySlug(stubH3Event({
		params: {
			id: String(eventId),
			slug,
		},
		headers: bearer === undefined
			? {}
			: { authorization: `Bearer ${bearer}` },
		// No middleware resolved the Event: the route reads it from its own path.
		context: {},
	}));
}

beforeAll(async () => {
	eventId = await stageEvent('Shown');
	programme = await stageScreen(eventId, 'programme', CAPABILITY);
	await stageScreen(await stageEvent('Elsewhere'), 'elsewhere', 'a-capability-of-another-events-screen');
});
beforeEach(() => {
	signedIn = false;
	sessionsAsked = 0;
});
afterAll(async () => await harness.close());

describe('the Screen lookup by slug', () => {
	// A Screen Output has no Session, so its capability must not wait on one.
	it('answers a bearer holding this Screen\'s capability, without asking about a Session', async () => {
		await expect(read('programme', CAPABILITY)).resolves.toMatchObject({ id: programme.id, slug: 'programme' });

		expect(sessionsAsked).toBe(0);
	});

	it('answers an operator\'s Session that presents no capability', async () => {
		signedIn = true;

		await expect(read('programme')).resolves.toMatchObject({ id: programme.id, slug: 'programme' });
	});

	// The digest and seed are the stored half of the credential the route just compared.
	it('never returns the capability digest it compared against, nor its seed', async () => {
		const answer = await read('programme', CAPABILITY);

		expect(JSON.stringify(answer)).not.toContain(programme.assetCapabilityDigest);
		expect(JSON.stringify(answer)).not.toContain(programme.assetCapabilitySeed);
		expect(answer).not.toHaveProperty('assetCapabilityDigest');
	});

	// One refusal, so a caller cannot learn from it which slugs exist.
	it.each<{ refused: string; slug: string; bearer?: string; session?: true }>([
		{ refused: 'no credential at all', slug: 'programme' },
		{ refused: 'another Screen\'s capability', slug: 'programme', bearer: 'a-capability-of-another-events-screen' },
		{
			refused: 'a slug no Screen has, whatever the credential',
			slug: 'unknown',
			bearer: CAPABILITY,
			session: true,
		},
		{ refused: 'a slug only another Event\'s Screen has', slug: 'elsewhere', session: true },
	])('refuses $refused with the one 404', async ({ slug, bearer, session }) => {
		signedIn = session ?? false;

		await expect(read(slug, bearer)).rejects.toMatchObject({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Screen not found',
		});
	});
});
