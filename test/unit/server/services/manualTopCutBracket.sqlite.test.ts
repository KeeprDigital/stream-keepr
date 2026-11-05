import type { ManualBracket } from '~~/shared/modules/top-cut-bracket';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Manual Bracket as its Screen shows it, and kept writable when a Player it
 * names is deleted (ADR-0075), against real SQLite so each Seed's Player name
 * and the release are the queries', not a mock's.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; statusMessage?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const mockPublication = {
	screenUpdated: vi.fn(async ({ entity }: { entity: unknown }) => entity),
	playerDeleted: vi.fn(),
	eventUpdated: vi.fn(async ({ entity }: { entity: unknown }) => entity),
};
vi.doMock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => mockPublication,
}));

const { findTopCutBracket } = await import('~~/server/services/topCutBracket');
const { screenService } = await import('~~/server/services/screen');
const { eventService } = await import('~~/server/services/event');
const { screenWriteModule } = await import('~~/server/modules/screen-write');
const { playerUpdateModule } = await import('~~/server/modules/player-update');

let mtgEventId: number;
let opEventId: number;
const mtg: Record<'kim' | 'lee' | 'foreign', number> = { kim: 0, lee: 0, foreign: 0 };
let opPlayerId: number;

function capability(suffix: string) {
	return {
		assetCapabilitySeed: `seed-${suffix}`,
		assetCapabilityVersion: 1,
		assetCapabilityDigest: `digest-${suffix}`,
	};
}

beforeAll(async () => {
	const [mtgEvent, opEvent] = await db.insert(schema.events).values([
		{ name: 'MTG Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		{ name: 'OP Event', game: 'op', featureMatchOrientation: 'horizontal' },
	]).returning({ id: schema.events.id });
	mtgEventId = mtgEvent!.id;
	opEventId = opEvent!.id;

	const [archetype] = await db.insert(schema.archetypes)
		.values({ eventId: mtgEventId, name: 'Izzet Prowess', colors: 'UR' })
		.returning({ id: schema.archetypes.id });
	const [kim, lee, foreign, opPlayer] = await db.insert(schema.players).values([
		{ eventId: mtgEventId, name: 'Kim', archetypeId: archetype!.id },
		{ eventId: mtgEventId, name: 'Lee' },
		{ eventId: opEventId, name: 'Foreign' },
		{ eventId: opEventId, name: '', nickname: 'luffy_fan' },
	]).returning({ id: schema.players.id });
	mtg.kim = kim!.id;
	mtg.lee = lee!.id;
	mtg.foreign = foreign!.id;
	opPlayerId = opPlayer!.id;
});

beforeEach(() => {
	mockPublication.screenUpdated.mockClear();
});

afterAll(async () => await harness.close());

function topCutConfig(manualBracket: ManualBracket, overrides: Record<string, unknown> = {}) {
	return {
		...getDefaultConfigForMode('top-cut'),
		bracketSource: 'manual' as const,
		manualBracket,
		...overrides,
	};
}

/** The first column's positions as entrant names, `-` for an empty seat. */
function firstColumn(bracket: Awaited<ReturnType<typeof findTopCutBracket>>['bracket']) {
	return bracket.columns[0]?.positions.map(position => position.entrants.map(entrant => entrant?.name ?? '-').join(' v '));
}

describe('a Manual Bracket as its Screen shows it', () => {
	it('names each Seed\'s Player by their current name, a typed Seed by its name, and a Player of another Event by nothing', async () => {
		const { bracket } = await findTopCutBracket(mtgEventId, 'mtg', topCutConfig({
			size: 4,
			entrants: [
				{ playerId: mtg.kim },
				{ name: 'Walk-in' },
				{ playerId: mtg.lee },
				{ playerId: mtg.foreign },
			],
			results: [],
		}));

		expect(firstColumn(bracket)).toEqual(['Kim v -', 'Walk-in v Lee']);
		expect(bracket.columns[0]!.positions[0]!.status).toBe('bye');
	});

	it.each([
		[
			{ showSeeds: false, showArchetypes: false },
			[
				{ playerId: 'kim', name: 'Kim' },
				{ playerId: null, name: 'Walk-in' },
			],
		],
		[
			{ showSeeds: true, showArchetypes: false },
			[
				{ playerId: 'kim', name: 'Kim', seed: 1 },
				{ playerId: null, name: 'Walk-in', seed: 4 },
			],
		],
		[
			{ showSeeds: false, showArchetypes: true },
			[
				{
					playerId: 'kim',
					name: 'Kim',
					deck: { name: 'Izzet Prowess', colors: 'UR' },
				},
				{ playerId: null, name: 'Walk-in', deck: null },
			],
		],
	])('shows a Seed and deck only while the Screen shows them: %j', async (shown, entrants) => {
		const { bracket } = await findTopCutBracket(mtgEventId, 'mtg', topCutConfig({
			size: 4,
			entrants: [
				{ playerId: mtg.kim },
				null,
				null,
				{ name: 'Walk-in' },
			],
			results: [],
		}, shown));

		expect(bracket.columns[0]!.positions[0]!.entrants).toEqual(entrants.map(entrant => ({
			...entrant,
			playerId: entrant.playerId == null
				? null
				: mtg.kim,
		})));
	});

	it.each([
		['phase', 'mtg', 'Phase', null],
		[
			'manual',
			'mtg',
			'Manual Bracket',
			['Kim v -', '- v -'],
		],
		[
			'phase',
			'op',
			'Manual Bracket',
			['luffy_fan v -', '- v -'],
		],
	] as const)('reads a %s source on a %s Event from its %s', async (bracketSource, game, _, column) => {
		const eventId = game === 'op'
			? opEventId
			: mtgEventId;
		const playerId = game === 'op'
			? opPlayerId
			: mtg.kim;
		const { phase, bracket } = await findTopCutBracket(eventId, game, topCutConfig({
			size: 4,
			entrants: [
				{ playerId },
			],
			results: [],
		}, { bracketSource }));

		expect(phase).toBeNull();
		expect(firstColumn(bracket) ?? null).toEqual(column);
	});
});

describe('deleting a Player a Manual Bracket names', () => {
	async function stage(slug: string, entrants: ManualBracket['entrants']) {
		const manualBracket: ManualBracket = {
			size: 4,
			entrants,
			results: [
				[
					{
						winner: 0,
						gameWins: [2, 1],
					},
				],
			],
		};
		const screen = await screenService().create(mtgEventId, {
			name: slug,
			slug,
			currentMode: 'top-cut',
			modeConfigs: {
				'top-cut': { bracketSource: 'manual', manualBracket },
			},
		} as never, capability(slug));
		return { screen, manualBracket };
	}

	it('empties only the Seeds naming them, keeps every result, announces the Screen once, and keeps it writable', async () => {
		const [doomed] = await db.insert(schema.players).values({ eventId: mtgEventId, name: 'Doomed' }).returning({ id: schema.players.id });
		const { screen } = await stage('names-doomed', [
			{ playerId: mtg.kim },
			{ name: 'Walk-in' },
			null,
			{ playerId: doomed!.id },
		]);
		const bystander = await stage('names-others', [
			{ playerId: mtg.lee },
		]);

		await playerUpdateModule().deletePlayer({ eventId: mtgEventId, playerId: doomed!.id, originConnectionId: 'delete-origin' });

		const released = await screenService().findById(screen.id, mtgEventId);
		expect(released?.modeConfigs?.['top-cut']?.manualBracket).toEqual({
			size: 4,
			entrants: [
				{ playerId: mtg.kim },
				{ name: 'Walk-in' },
				null,
				null,
			],
			results: [
				[
					{
						winner: 0,
						gameWins: [2, 1],
					},
				],
			],
		});
		expect(released?.stateVersion).toBe(screen.stateVersion + 1);
		expect(mockPublication.screenUpdated).toHaveBeenCalledOnce();
		expect(mockPublication.screenUpdated).toHaveBeenCalledWith({
			eventId: mtgEventId,
			entity: expect.objectContaining({ id: screen.id, stateVersion: screen.stateVersion + 1 }),
		});
		expect((await screenService().findById(bystander.screen.id, mtgEventId))?.stateVersion).toBe(bystander.screen.stateVersion);

		await expect(screenWriteModule().updateModeConfig({
			authoringSessionId: undefined,
			eventId: mtgEventId,
			screenId: screen.id,
			mode: 'top-cut',
			config: { manualBracket: released!.modeConfigs!['top-cut']!.manualBracket, showSeeds: true },
			stateVersion: released!.stateVersion,
			graphicsAssets: () => ({
				inspectGraphicAssetRevisions: vi.fn(),
			}),
		})).resolves.toBeDefined();
		// A PATCH replaces the Manual Bracket whole, its empty Seeds kept in place.
		expect((await screenService().findById(screen.id, mtgEventId))?.modeConfigs?.['top-cut']?.manualBracket?.entrants)
			.toEqual([
				{ playerId: mtg.kim },
				{ name: 'Walk-in' },
				null,
				null,
			]);
	});

	it('empties the Seeds of the Players a Melee data reset deletes', async () => {
		const [imported] = await db.insert(schema.players).values({
			eventId: mtgEventId,
			name: 'Imported',
			externalSource: 'melee',
			externalId: 'melee-manual-bracket',
		}).returning({ id: schema.players.id });
		const { screen } = await stage('names-imported', [
			{ playerId: imported!.id },
			{ playerId: mtg.kim },
		]);

		const reset = await eventService().updateMeleeConfig(mtgEventId, { meleeEnabled: false, meleeEventId: null, meleeClientId: null });

		expect(reset?.clearedScreens).toContainEqual(expect.objectContaining({ id: screen.id, stateVersion: screen.stateVersion + 1 }));
		expect((await screenService().findById(screen.id, mtgEventId))?.modeConfigs?.['top-cut']?.manualBracket?.entrants)
			.toEqual([
				null,
				{ playerId: mtg.kim },
			]);
	});
});
