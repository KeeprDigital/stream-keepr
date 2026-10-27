import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Graphic Style Sets and Animation Effect Presets are removed with no data
 * migration (#830, ADR-0049). A linked Broadcast Graphic Template keeps its
 * document, and so its values as literals; the libraries and link columns go.
 */
describe('the Graphic Style Set removal migration', () => {
	let harness: SqliteD1Harness;

	afterEach(async () => {
		await harness.close();
	});

	const document = {
		id: 'lower-third',
		name: 'Lower third',
		items: [],
		styleSet: { styleSetId: 'show-style', revision: 3 },
	};

	async function arrange() {
		harness = await createSqliteD1Harness({ throughMigration: '0010' });
		await harness.client.execute(`
			INSERT INTO graphic_style_sets (id, name, revision, draft_revision, draft, published)
			VALUES ('show-style', 'Show style', 3, 4, '[]', '[]')
		`);
		await harness.client.execute(`
			INSERT INTO animation_effect_presets (id, name, revision, selection)
			VALUES ('fog', 'Fog', 1, '{"effect":"fog"}')
		`);
		await harness.client.execute({
			sql: `
				INSERT INTO broadcast_graphic_templates (id, name, revision, document, style_set_id, style_set_revision)
				VALUES ('template-1', 'Lower third', 2, ?, 'show-style', 3)
			`,
			args: [
				JSON.stringify(document),
			],
		});
		await harness.applyRemainingMigrations();
	}

	async function tables() {
		const result = await harness.client.execute(`SELECT name FROM sqlite_master WHERE type = 'table'`);
		return result.rows.map(row => String(row.name));
	}

	it('drops the Graphic Style Set and Animation Effect Preset libraries', async () => {
		await arrange();

		expect(await tables()).not.toContain('graphic_style_sets');
		expect(await tables()).not.toContain('animation_effect_presets');
	});

	it('keeps a linked template, its revision and document, without the link columns', async () => {
		await arrange();

		const result = await harness.client.execute('SELECT * FROM broadcast_graphic_templates');

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toMatchObject({ id: 'template-1', revision: 2 });
		expect(result.rows[0]).not.toHaveProperty('style_set_id');
		expect(result.rows[0]).not.toHaveProperty('style_set_revision');
		expect(JSON.parse(String(result.rows[0]!.document))).toEqual(document);
	});
});
