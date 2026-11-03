import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createFakeNitroApp, installNitroPlugin } from '~~/test/helpers/nitroApp';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/*
 * Under a local launcher no cron fires, so the dev server fires the Worker's
 * minute cron hook itself; a deployed Worker never does.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));
vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin);

const { default: installCronPlugin } = await import('~~/server/plugins/melee-live-results-schedule');
const { startLocalLiveResultsSchedule } = await import('~~/server/modules/melee-sync/liveResults/localSchedule');

afterAll(async () => await harness.close());

/** A Nitro app with the real Live Results cron plugin installed. */
function nitroAppWithCronPlugin() {
	const nitroApp = createFakeNitroApp();
	installNitroPlugin(installCronPlugin, nitroApp);
	return {
		// The fake has only the hook methods the schedule calls.
		nitroApp: nitroApp as unknown as Parameters<typeof startLocalLiveResultsSchedule>[0],
		close: async () => await nitroApp.hooks.callHook('close'),
	};
}

const start = new Date('2026-11-03T12:00:00.000Z');

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
	it('under the dev server, ticks a due Event at once and again in a later minute', async () => {
		const eventId = await seedEvent();
		const app = nitroAppWithCronPlugin();

		startLocalLiveResultsSchedule(app.nitroApp, { dev: true });
		await vi.advanceTimersByTimeAsync(0);
		const atStart = await lastCheckedAt(eventId);
		await advanceMinutes(5);
		const later = await lastCheckedAt(eventId);
		await app.close();

		expect(atStart).toEqual(start);
		expect(later!.getTime()).toBeGreaterThan(start.getTime());
	});

	it('in a deployed Worker, never ticks: its real cron does', async () => {
		const eventId = await seedEvent();
		const app = nitroAppWithCronPlugin();

		startLocalLiveResultsSchedule(app.nitroApp, { dev: false });
		await advanceMinutes(5);
		await app.close();

		expect(await lastCheckedAt(eventId)).toBeNull();
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
