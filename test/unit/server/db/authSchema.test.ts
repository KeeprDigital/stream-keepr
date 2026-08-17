import { getAuthTables } from 'better-auth/db';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as authSchema from '~~/server/db/schema/auth';
import { authStaticOptions } from '~~/server/utils/authOptions';

/**
 * Pin the hand-maintained Drizzle auth schema to the table contract Better Auth
 * itself derives from this installation's options (#393). The Better Auth CLI
 * is versioned apart from the library and could not be run against the pinned
 * library version, so the schema is maintained by hand — this suite is what
 * keeps a version bump honest: a bump that adds, renames, or retypes a field
 * fails here, which is the signal that a migration is owed.
 *
 * The Drizzle adapter resolves columns by TypeScript property key, which must
 * equal the Better Auth field name; the SQL name underneath is free, and this
 * repo spells SQL identifiers in snake_case.
 */

const tables = getAuthTables(authStaticOptions);

/** Independent spelling of the repo's SQL naming convention. */
function snakeCase(name: string): string {
	return name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

const sqlTypeByFieldType: Record<string, string> = {
	string: 'text',
	boolean: 'integer',
	date: 'integer',
	number: 'integer',
};

describe('better Auth drizzle schema', () => {
	it('exports one table per Better Auth model, under the model name', () => {
		const modelNames = Object.values(tables).map(table => table.modelName).toSorted();
		expect(modelNames).toEqual(['account', 'session', 'user', 'verification']);

		for (const { modelName } of Object.values(tables)) {
			const table = authSchema[modelName as keyof typeof authSchema];
			expect(table, `missing export for model "${modelName}"`).toBeDefined();
			expect(getTableConfig(table).name).toBe(modelName);
		}
	});

	describe.each(Object.values(tables).map(table => [table.modelName, table] as const))(
		'model %s',
		(modelName, model) => {
			const table = authSchema[modelName as keyof typeof authSchema];
			const config = getTableConfig(table);
			const columnsByKey = new Map(
				Object.entries(table).filter(([, value]) => config.columns.includes(value as never)),
			);

			it('carries exactly the contract fields plus id', () => {
				const expectedKeys = [
					'id',
					...Object.entries(model.fields).map(([key, field]) => field.fieldName ?? key),
				].toSorted();
				expect([...columnsByKey.keys()].toSorted()).toEqual(expectedKeys);
			});

			it('names id as the text primary key', () => {
				const id = columnsByKey.get('id')!;
				expect(id.primary).toBe(true);
				expect(id.getSQLType()).toBe('text');
			});

			describe.each(Object.entries(model.fields).map(([key, field]) => [field.fieldName ?? key, field] as const))(
				'field %s',
				(fieldName, field) => {
					const column = columnsByKey.get(fieldName)!;

					it('exists with the snake_case SQL name and contract type', () => {
						expect(column).toBeDefined();
						expect(column.name).toBe(snakeCase(fieldName));
						expect(column.getSQLType()).toBe(sqlTypeByFieldType[field.type as string]);
					});

					it('matches the contract on required', () => {
						expect(column.notNull).toBe(field.required === true);
					});

					it('matches the contract on unique', () => {
						expect(column.isUnique).toBe(field.unique === true);
					});

					if (field.references) {
						it('references the contract target with the contract delete rule', () => {
							const foreignKey = config.foreignKeys.find(candidate =>
								candidate.reference().columns.some(referencing => referencing.name === column.name));
							expect(foreignKey, `no foreign key on "${fieldName}"`).toBeDefined();
							const reference = foreignKey!.reference();
							expect(getTableConfig(reference.foreignTable).name).toBe(field.references!.model);
							expect(reference.foreignColumns.map(target => target.name)).toEqual([field.references!.field]);
							expect(foreignKey!.onDelete).toBe(field.references!.onDelete);
						});
					}

					if (field.index) {
						it('is covered by an index', () => {
							const indexed = config.indexes.some(entry =>
								entry.config.columns.some(indexColumn =>
									'name' in indexColumn && indexColumn.name === column.name));
							expect(indexed).toBe(true);
						});
					}
				},
			);
		},
	);
});
