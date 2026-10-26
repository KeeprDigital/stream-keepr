import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, describe, expect, it } from 'vitest';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Top Cut Bracket's Screen Mode key was `topCut`, the one camelCase Screen Mode key,
 * and is `top-cut` (#773). Deployed installations store the old key in a Screen's
 * current mode, as a key of its mode configurations, and as the root of the owner
 * slots its Top Cut Bracket Background Layers index under.
 */
describe('the Top Cut Bracket Screen Mode key migration', () => {
	let harness: SqliteD1Harness;

	afterEach(async () => {
		await harness.close();
	});

	async function insertEvent() {
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Existing Event', 'mtg', 'horizontal')
		`);
	}

	async function insertScreen(id: number, currentMode: string, modeConfigs: unknown) {
		await harness.client.execute({
			sql: `
				INSERT INTO screens (id, event_id, name, slug, current_mode, mode_configs, asset_capability_seed, asset_capability_digest)
				VALUES (?, 1, ?, ?, ?, ?, ?, ?)
			`,
			args: [
				id,
				`Screen ${id}`,
				`screen-${id}`,
				currentMode,
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
			sql: 'SELECT current_mode, mode_configs FROM screens WHERE id = ?',
			args: [id],
		});
		const row = result.rows[0]!;
		return {
			currentMode: row.current_mode,
			modeConfigs: row.mode_configs === null
				? null
				: JSON.parse(String(row.mode_configs)),
		};
	}

	async function insertReference(id: string, ownerKind: string, ownerSlot: string) {
		await harness.client.execute({
			sql: `
				INSERT INTO graphic_asset_references (id, asset_id, revision_id, owner_kind, owner_id, owner_slot, event_id)
				VALUES (?, 'asset-1', 'revision-1', ?, '1', ?, 1)
			`,
			args: [id, ownerKind, ownerSlot],
		});
	}

	async function insertGraphicAsset() {
		await harness.client.execute(`
			INSERT INTO graphic_asset_contents (digest, byte_length, canonical_mime)
			VALUES ('digest-1', 1, 'image/png')
		`);
		await harness.client.execute(`
			INSERT INTO graphic_assets (id, name, kind) VALUES ('asset-1', 'Plate', 'image')
		`);
		await harness.client.execute(`
			INSERT INTO graphic_asset_revisions (id, asset_id, revision_number, content_digest, compatibility_profile, technical_facts)
			VALUES ('revision-1', 'asset-1', 1, 'digest-1', 'image', '{}')
		`);
	}

	it('moves a Screen in Top Cut Bracket mode, and its Top Cut Bracket config, to the top-cut key', async () => {
		harness = await createSqliteD1Harness({ throughMigration: '0002' });
		await insertEvent();
		await insertScreen(1, 'topCut', {
			topCut: {
				phaseId: 4,
				showSeeds: true,
				showArchetypes: true,
				showHeader: false,
				backgroundLayers: [
					{ id: 'layer-1', type: 'color' },
				],
			},
			standings: { rowsPerPage: 8 },
		});

		await harness.applyRemainingMigrations();

		expect(await readScreen(1)).toEqual({
			currentMode: 'top-cut',
			modeConfigs: {
				'top-cut': {
					phaseId: 4,
					showSeeds: true,
					showArchetypes: true,
					showHeader: false,
					backgroundLayers: [
						{ id: 'layer-1', type: 'color' },
					],
				},
				'standings': { rowsPerPage: 8 },
			},
		});

		// Read as every Top Cut Bracket rendering and the Screen Output read do.
		const { currentMode, modeConfigs } = await readScreen(1);
		expect(SCREEN_MODE_VALUES).toContain(currentMode);
		expect(resolveScreenModeConfig(modeConfigs, 'top-cut')).toMatchObject({
			phaseId: 4,
			showSeeds: true,
			showArchetypes: true,
			showHeader: false,
		});
	});

	it('moves a Top Cut Bracket config held by a Screen in another mode, and leaves Screens without one alone', async () => {
		harness = await createSqliteD1Harness({ throughMigration: '0002' });
		await insertEvent();
		await insertScreen(1, 'standings', {
			topCut: { phaseId: 4 },
		});
		await insertScreen(2, 'top-cards', {
			'top-cards': { columns: 4 },
		});
		await insertScreen(3, 'background', null);

		await harness.applyRemainingMigrations();

		expect(await readScreen(1)).toEqual({
			currentMode: 'standings',
			modeConfigs: {
				'top-cut': { phaseId: 4 },
			},
		});
		expect(await readScreen(2)).toEqual({
			currentMode: 'top-cards',
			modeConfigs: {
				'top-cards': { columns: 4 },
			},
		});
		expect(await readScreen(3)).toEqual({ currentMode: 'background', modeConfigs: null });
	});

	it('keeps the top-cut config of a Screen holding both keys, as a Screen write does', async () => {
		harness = await createSqliteD1Harness({ throughMigration: '0002' });
		await insertEvent();
		await insertScreen(1, 'topCut', {
			'topCut': { phaseId: 4 },
			'top-cut': { phaseId: 5 },
		});

		await harness.applyRemainingMigrations();

		expect(await readScreen(1)).toEqual({
			currentMode: 'top-cut',
			modeConfigs: {
				'top-cut': { phaseId: 5 },
			},
		});
	});

	it('re-roots a Screen\'s Top Cut Bracket Background Layer references, and only those', async () => {
		harness = await createSqliteD1Harness({ throughMigration: '0002' });
		await insertEvent();
		await insertGraphicAsset();
		await insertScreen(1, 'topCut', {
			topCut: { phaseId: 4 },
		});
		await insertReference('top-cut-layer', 'screen', 'topCut.backgroundLayers.layer-1.source');
		await insertReference('top-cards-layer', 'screen', 'top-cards.backgroundLayers.layer-2.source');
		await insertReference('template-slot', 'broadcast-graphic-template', 'topCut.backgroundLayers.layer-3.source');

		await harness.applyRemainingMigrations();

		const result = await harness.client.execute('SELECT id, owner_slot FROM graphic_asset_references ORDER BY id');
		expect(result.rows.map(row => [row.id, row.owner_slot])).toEqual([
			['template-slot', 'topCut.backgroundLayers.layer-3.source'],
			['top-cards-layer', 'top-cards.backgroundLayers.layer-2.source'],
			['top-cut-layer', 'top-cut.backgroundLayers.layer-1.source'],
		]);
	});
});
