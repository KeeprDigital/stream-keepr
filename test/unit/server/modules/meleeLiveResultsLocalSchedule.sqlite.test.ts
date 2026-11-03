import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/*
 * Under a local launcher no cron fires, so the dev server fires the Worker's
 * minute cron hook itself; a deployed Worker never does. Each Event's poll state
 * still decides whether it is due.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));
vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin);

const { default: installCronPlugin } = await import('~~/server/plugins/melee-live-results-schedule');
const { startLocalLiveResultsSchedule } = await import('~~/server/modules/melee-sync/liveResults/localSchedule');

afterAll(async () => await harness.close());

type Handler = (payload: unknown) => unknown;

/** The slice of a Nitro app the cron plugin and local schedule use, with the real cron plugin installed. */
function nitroAppWithCronPlugin() {
	const handlers = new Map<string, Handler[]>();
	const nitroApp = {
		hooks: {
			hook: (name: string, handler: Handler) => {
				handlers.set(name, [
					...handlers.get(name) ?? [],
					handler,
				]);
			},
			callHook: async (name: string, payload: unknown) => {
				for (const handler of handlers.get(name) ?? [])
					await handler(payload);
			},
		},
	};
	(installCronPlugin as unknown as (app: typeof nitroApp) => void)(nitroApp);
	return {
		// The test's Nitro app has only the hook methods these call.
		nitroApp: nitroApp as unknown as Parameters<typeof startLocalLiveResultsSchedule>[0],
		close: async () => await nitroApp.hooks.callHook('close', undefined),
	};
}

const start = new Date('2026-11-03T12:00:00.000Z');
const minutesLater = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

/** An Event with Live Results on and no Rounds: every tick idles, asking Melee nothing. */
async function seedEvent() {
	const [event] = await db.insert(schema.events).values({
		name: 'Melee Championship',
		game: 'mtg',
		featureMatchOrientation: 'horizontal',
		meleeEnabled: true,
		meleeEventId: 'melee-local',
		meleeLiveResultsEnabled: true,
	}).returning();
	return event!.id;
}

async function lastCheckedAt(eventId: number) {
	const event = await db.query.events.findFirst({
		where: eq(schema.events.id, eventId),
	});
	return event!.meleeLiveResultsLastCheckedAt;
}

/** Advances the clock a minute at a time, letting each firing settle. */
async function advanceMinutes(minutes: number) {
	for (let minute = 0; minute < minutes; minute++)
		await vi.advanceTimersByTimeAsync(60_000);
}

beforeEach(() => {
	vi.useFakeTimers({
		toFake: ['setInterval', 'clearInterval', 'Date'],
	});
	vi.setSystemTime(start);
});
afterEach(() => vi.useRealTimers());

describe('the local Live Results schedule', () => {
	it.each([
		{
			dev: true,
			checked: [
				start,
				minutesLater(1),
				minutesLater(1),
				minutesLater(3),
			],
		},
		{
			dev: false,
			checked: [null, null, null, null],
		},
	])('in dev $dev, ticks due Events at once and each minute after', async ({ dev, checked }) => {
		const eventId = await seedEvent();
		const app = nitroAppWithCronPlugin();

		startLocalLiveResultsSchedule(app.nitroApp, { dev });
		await vi.advanceTimersByTimeAsync(0);
		const seen = [await lastCheckedAt(eventId)];
		// An idle tick backs off: due again in 1 minute, then in 2.
		for (const _minute of [1, 2, 3]) {
			await advanceMinutes(1);
			seen.push(await lastCheckedAt(eventId));
		}
		await app.close();

		expect(seen).toEqual(checked);
	});

	it('stops when the dev server closes', async () => {
		const eventId = await seedEvent();
		const app = nitroAppWithCronPlugin();
		startLocalLiveResultsSchedule(app.nitroApp, { dev: true });
		await vi.advanceTimersByTimeAsync(0);

		await app.close();
		await advanceMinutes(5);

		expect(await lastCheckedAt(eventId)).toEqual(start);
	});
});
