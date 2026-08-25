import { describe, expect, it } from 'vitest';
import {
	broadcastDeckListParamsSchema,
	createBroadcastDeckListSchema,
	deleteBroadcastDeckListSchema,
	updateBroadcastDeckListSchema,
} from '~~/server/schemas/api/broadcastDeckList';

describe('broadcast Deck List API schemas', () => {
	it('accepts bounded create and revisioned mutation bodies', () => {
		expect(createBroadcastDeckListSchema.parse({
			name: ' Burn ',
			sourceText: '4 Lightning Bolt',
			archetypeLabel: ' Aggro ',
			colors: 'RW',
		})).toEqual({
			name: 'Burn',
			sourceText: '4 Lightning Bolt',
			archetypeLabel: 'Aggro',
			colors: 'RW',
		});
		expect(updateBroadcastDeckListSchema.parse({ expectedRevision: 2, name: 'Renamed' })).toEqual({ expectedRevision: 2, name: 'Renamed' });
		expect(deleteBroadcastDeckListSchema.parse({ expectedRevision: 2 })).toEqual({ expectedRevision: 2 });
		expect(broadcastDeckListParamsSchema.parse({ id: '7', listId: '11' })).toEqual({ id: 7, listId: 11 });
	});

	it('rejects unknown, empty, unbounded, and malformed fields', () => {
		expect(() => createBroadcastDeckListSchema.parse({ name: 'Deck', sourceText: '1 Island', surprise: true })).toThrow();
		expect(() => createBroadcastDeckListSchema.parse({ name: ' ', sourceText: '1 Island' })).toThrow();
		expect(() => createBroadcastDeckListSchema.parse({ name: 'Deck', sourceText: 'x'.repeat(64 * 1024 + 1) })).toThrow();
		expect(() => createBroadcastDeckListSchema.parse({ name: 'Deck', sourceText: '1 Island', colors: 'WW' })).toThrow();
		expect(() => updateBroadcastDeckListSchema.parse({ expectedRevision: 1 })).toThrow();
		expect(() => updateBroadcastDeckListSchema.parse({ expectedRevision: 0, name: 'Nope' })).toThrow();
		expect(() => deleteBroadcastDeckListSchema.parse({ expectedRevision: 1, extra: true })).toThrow();
		expect(() => broadcastDeckListParamsSchema.parse({ id: 7, listId: 'not-an-id' })).toThrow();
	});
});
