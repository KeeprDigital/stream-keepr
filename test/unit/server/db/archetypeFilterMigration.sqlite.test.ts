import type { ModeConfigsMap } from '~~/shared/types/screenConfig';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONVERSION_TARGET } from '~~/shared/conversionTarget';
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';
import { metagameScreenQuery, topCardsScreenQuery } from '~~/shared/utils/metagameQuery';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Metagame or Most Played Cards Screen stored its Archetype filter as the
 * Archetype's name, and stores its id (#1153). A name one Archetype of the
 * Screen's Event holds becomes that id; any other name is cleared.
 */
describe('the Archetype filter migration', () => {
	let harness: SqliteD1Harness;

	const MONO_RED = 11;

	beforeEach(async () => {
		harness = await createSqliteD1Harness({ throughMigration: '0000' });
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Screen Event', 'mtg', 'horizontal'), (2, 'Other Event', 'op', 'horizontal')
		`);
		await harness.client.execute(`
			INSERT INTO archetypes (id, event_id, name)
			VALUES (${MONO_RED}, 1, 'Mono Red'), (12, 1, 'Izzet'), (13, 1, 'IZZET'), (21, 2, 'Elsewhere'), (22, 2, 'Mono Red')
		`);
	});

	afterEach(async () => {
		await harness.close();
	});

	async function insertScreen(id: number, modeConfigs: unknown, eventId = 1) {
		await harness.client.execute({
			sql: `
				INSERT INTO screens (id, event_id, name, slug, current_mode, mode_configs, asset_capability_seed, asset_capability_digest)
				VALUES (?, ?, ?, ?, 'metagame', ?, ?, ?)
			`,
			args: [
				id,
				eventId,
				`Screen ${id}`,
				`screen-${id}`,
				modeConfigs === null
					? null
					: JSON.stringify(modeConfigs),
				`seed-${id}`,
				`digest-${id}`,
			],
		});
	}

	async function readScreen(id: number) {
		const result = await harness.client.execute({
			sql: 'SELECT mode_configs, state_version FROM screens WHERE id = ?',
			args: [id],
		});
		const row = result.rows[0]!;
		return {
			stateVersion: Number(row.state_version),
			modeConfigs: row.mode_configs === null
				? null
				: JSON.parse(String(row.mode_configs)),
		};
	}

	/** The Archetype the Screen's card read is narrowed to, as its Screen Output read asks. */
	function filteredTo(modeConfigs: ModeConfigsMap, mode: 'metagame' | 'top-cards'): number | undefined {
		if (mode === 'top-cards')
			return topCardsScreenQuery(resolveScreenModeConfig(modeConfigs, 'top-cards')).archetypeId;
		const { query } = metagameScreenQuery(resolveScreenModeConfig({
			metagame: { ...modeConfigs.metagame, viewMode: 'cards' },
		}, 'metagame'), DEFAULT_CONVERSION_TARGET);
		return 'archetypeId' in query
			? query.archetypeId
			: undefined;
	}

	// Each mode's filter is rewritten by a statement of its own.
	describe.each(['metagame', 'top-cards'] as const)('a %s Screen', (mode) => {
		it.each([
			{
				name: 'naming one Archetype of its Event is filtered to it',
				stored: 'Mono Red',
				archetypeId: MONO_RED,
			},
			{
				name: 'naming one in another case, with surrounding spaces, is filtered to it',
				stored: '  mono red ',
				archetypeId: MONO_RED,
			},
			{
				name: 'naming no Archetype is unfiltered',
				stored: 'Deleted Since',
				archetypeId: undefined,
			},
			{
				name: 'naming only another Event\'s Archetype is unfiltered',
				stored: 'Elsewhere',
				archetypeId: undefined,
			},
			{
				name: 'naming several Archetypes, differing only by case, is unfiltered',
				stored: 'Izzet',
				archetypeId: undefined,
			},
		])('$name', async ({ stored, archetypeId }) => {
			await insertScreen(1, {
				[mode]: { archetypeFilter: stored, scope: 'topN', topN: 16 },
				standings: { rowsPerPage: 8 },
			});

			await harness.applyRemainingMigrations();

			const { modeConfigs } = await readScreen(1);
			expect(modeConfigs).toEqual({
				[mode]: {
					scope: 'topN',
					topN: 16,
					...(archetypeId === undefined
						? {}
						: { archetypeId }),
				},
				standings: { rowsPerPage: 8 },
			});
			expect(filteredTo(modeConfigs, mode)).toBe(archetypeId);
		});
	});

	it('migrates both filters of one Screen, each against that Screen\'s own Event', async () => {
		await insertScreen(1, {
			'metagame': { archetypeFilter: 'Mono Red' },
			'top-cards': { archetypeFilter: 'Elsewhere' },
		}, 2);

		await harness.applyRemainingMigrations();

		expect((await readScreen(1)).modeConfigs).toEqual({
			'metagame': { archetypeId: 22 },
			'top-cards': { archetypeId: 21 },
		});
	});

	it('leaves a Screen storing no filter name as it is', async () => {
		const unfiltered = {
			'metagame': { viewMode: 'cards', limit: 20 },
			'top-cards': { limit: 12 },
		};
		await insertScreen(1, unfiltered);
		await insertScreen(2, null);

		await harness.applyRemainingMigrations();

		expect(await readScreen(1)).toEqual({ stateVersion: 0, modeConfigs: unfiltered });
		expect(await readScreen(2)).toEqual({ stateVersion: 0, modeConfigs: null });
	});
});
