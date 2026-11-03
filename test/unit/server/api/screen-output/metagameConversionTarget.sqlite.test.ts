import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Screen Output's Metagame and Archetype Spotlight reads count Conversion Rate
// against their Event's Conversion Target, never one the Screen stored (ADR-0061).

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/screenOutputAuthorization', () => ({
	screenOutputReader: async () => 'capability',
}));

interface StubEvent { params: Record<string, string> }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('setResponseHeader', vi.fn());
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

type Handler = (event: StubEvent) => Promise<any>;
const readSpotlight = (await import('~~/server/api/screen-output/events/[id]/screens/[screenId]/archetype-spotlight.get')).default as unknown as Handler;
const readMetagame = (await import('~~/server/api/screen-output/events/[id]/screens/[screenId]/metagame.get')).default as unknown as Handler;

let eventId: number;
const screenIds: Record<string, number> = {};

beforeAll(async () => {
	const [event] = await db.insert(schema.events).values({ name: 'Pro Tour', game: 'mtg', featureMatchOrientation: 'horizontal' }).returning({ id: schema.events.id });
	eventId = event!.id;
	const [archetype] = await db.insert(schema.archetypes).values({ eventId, name: 'Mono Red' }).returning({ id: schema.archetypes.id });
	// Two pilots: 1st on 15 points, 10th on 9 points.
	await db.insert(schema.players).values([
		{
			eventId,
			name: 'Ada',
			position: 1,
			points: 15,
			archetypeId: archetype!.id,
		},
		{
			eventId,
			name: 'Bo',
			position: 10,
			points: 9,
			archetypeId: archetype!.id,
		},
	]);

	// Each Screen stores the per-Screen target it held before the Event had one.
	const formerTarget = { conversionMetric: 'minPoints', conversionThreshold: 0 };
	const screens = await db.insert(schema.screens).values([
		['spotlight', 'archetype-spotlight'],
		['metagame', 'metagame'],
	].map(([slug, currentMode], index) => ({
		eventId,
		name: slug!,
		slug: slug!,
		currentMode: currentMode as 'metagame',
		modeConfigs: {
			'archetype-spotlight': { archetypeId: archetype!.id, ...formerTarget },
			'metagame': formerTarget,
		} as never,
		assetCapabilitySeed: `seed-${index}`,
		assetCapabilityDigest: `digest-${index}`,
	}))).returning({ id: schema.screens.id, slug: schema.screens.slug });
	for (const screen of screens)
		screenIds[screen.slug] = screen.id;
});

afterAll(async () => await harness.close());

function params(screen: string) {
	return {
		params: {
			id: String(eventId),
			screenId: String(screenIds[screen]),
		},
	};
}

async function conversionRates() {
	const spotlight = await readSpotlight(params('spotlight'));
	const metagame = await readMetagame(params('metagame'));
	return {
		spotlight: spotlight.conversionRate,
		metagame: metagame.breakdown.entries.find((entry: { name: string }) => entry.name === 'Mono Red').conversionRate,
	};
}

describe('a Screen Output\'s Conversion Rate', () => {
	it.each([
		// An Event created before the target existed reads Top 8, whatever its Screens stored.
		{ target: null, rate: 50 },
		{
			target: { conversionMetric: 'topN', conversionThreshold: 10 },
			rate: 100,
		},
		{
			target: { conversionMetric: 'minPoints', conversionThreshold: 12 },
			rate: 50,
		},
		{
			target: { conversionMetric: 'minPoints', conversionThreshold: 0 },
			rate: 100,
		},
	] as const)('counts against the Event\'s target $target', async ({ target, rate }) => {
		if (target)
			await db.update(schema.events).set(target).where(eq(schema.events.id, eventId));

		await expect(conversionRates()).resolves.toEqual({ spotlight: rate, metagame: rate });
	});
});
