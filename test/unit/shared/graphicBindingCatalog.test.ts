import type { GraphicBindingDataSet } from '~~/shared/modules/graphics';
import { describe, expect, it } from 'vitest';
import {
	GRAPHIC_BINDING_CATALOG,
	graphicBindingField,
	graphicBindingFields,
	isGraphicBindingFieldCompatible,
	resolveGraphicBindingField,
} from '~~/shared/modules/graphics';

/**
 * The Graphic Input Binding field catalog: what an operator may bind to, stated
 * once, curated, and typed.
 *
 * Every assertion here is about the catalog as an operator meets it — which fields
 * a source kind offers on this Event's game, what type each may bind to, and what
 * one resolves to from Event Data. Nothing asserts how a field is stored.
 */

const MTG_EVENT: NonNullable<GraphicBindingDataSet['event']> = {
	name: 'Regional Championship',
	description: 'Round 5',
	game: 'mtg',
	displayRecordSeparator: '-',
	displayHideZeroDraws: true,
	displayPositionFormat: 'ordinal',
	commentator1TalentId: 7,
	commentator2TalentId: null,
};

function dataSet(overrides: Partial<GraphicBindingDataSet> = {}): GraphicBindingDataSet {
	return {
		event: MTG_EVENT,
		players: {},
		talents: {},
		phases: {},
		rounds: {},
		matches: {},
		featureMatchSlots: {},
		archetypes: {},
		...overrides,
	};
}

describe('graphic Input Binding field catalog', () => {
	it('offers a field for every single-entity Graphic Source Selection kind', () => {
		for (const kind of Object.keys(GRAPHIC_BINDING_CATALOG)) {
			expect(
				graphicBindingFields(kind as keyof typeof GRAPHIC_BINDING_CATALOG, 'mtg').length,
				`${kind} offers no bindable field`,
			).toBeGreaterThan(0);
		}
	});

	it('separates stable common fields from ones specific to the Event\'s game', () => {
		const mtg = graphicBindingFields('player', 'mtg').map(field => field.id);
		const op = graphicBindingFields('player', 'op').map(field => field.id);

		// A Player's name is a common field: every game's Event has one.
		expect(mtg).toContain('player.name');
		expect(op).toContain('player.name');
		// Deck name is Magic's, Leader is One Piece's, and neither Event offers the
		// other's — an operator never sees a field this Event cannot resolve.
		expect(mtg).toContain('player.deckName');
		expect(op).not.toContain('player.deckName');
		expect(op).toContain('player.leader');
		expect(mtg).not.toContain('player.leader');
	});

	it('exposes atomic typed fields and explicitly named broadcast-formatted ones', () => {
		expect(graphicBindingField('player', 'player.wins')).toMatchObject({ type: 'number', shape: 'atomic' });
		expect(graphicBindingField('player', 'player.record')).toMatchObject({ type: 'text', shape: 'formatted' });
	});

	it('accepts a binding only for a Graphic Input of the field\'s own type', () => {
		expect(isGraphicBindingFieldCompatible('player', 'player.name', 'text')).toBe(true);
		expect(isGraphicBindingFieldCompatible('player', 'player.name', 'number')).toBe(false);
		expect(isGraphicBindingFieldCompatible('player', 'player.wins', 'number')).toBe(true);
	});

	it('offers no field for a ticking clock or collection-shaped state', () => {
		const slot = graphicBindingFields('feature-match-slot', 'mtg').map(field => field.id);

		expect(slot.some(id => /clock/i.test(id))).toBe(false);
		expect(slot.some(id => /counters/i.test(id))).toBe(false);
	});

	it('formats a Player record with the Event\'s own broadcast separator', () => {
		const player = { name: 'Ava Reed', wins: 4, losses: 1, draws: 0 };

		expect(resolveGraphicBindingField('player', 'player.record', player, dataSet())).toBe('4-1');
		expect(resolveGraphicBindingField('player', 'player.record', player, dataSet({
			event: { ...MTG_EVENT, displayRecordSeparator: ' | ', displayHideZeroDraws: false },
		}))).toBe('4 | 1 | 0');
	});

	it('formats a Player position the way the Event displays positions', () => {
		const player = { name: 'Ava Reed', position: 3 };

		expect(resolveGraphicBindingField('player', 'player.position', player, dataSet())).toBe(3);
		expect(resolveGraphicBindingField('player', 'player.positionDisplay', player, dataSet())).toBe('3rd');
		expect(resolveGraphicBindingField('player', 'player.positionDisplay', player, dataSet({
			event: { ...MTG_EVENT, displayPositionFormat: 'number' },
		}))).toBe('3');
	});

	it('resolves nothing for a field the entity has no value for', () => {
		expect(resolveGraphicBindingField('player', 'player.pronouns', { name: 'Ava Reed' }, dataSet()))
			.toBeUndefined();
		expect(resolveGraphicBindingField('player', 'player.record', { name: 'Ava Reed' }, dataSet()))
			.toBeUndefined();
	});

	it('reads a Player\'s Archetype name through the Event\'s Archetypes', () => {
		const data = dataSet({ archetypes: { 12: { name: 'Azorius Control', colors: 'WU' } } });

		expect(resolveGraphicBindingField('player', 'player.archetypeName', { name: 'Ava', archetypeId: 12 }, data))
			.toBe('Azorius Control');
		expect(resolveGraphicBindingField('player', 'player.archetypeName', { name: 'Ava', archetypeId: 99 }, data))
			.toBeUndefined();
	});
});
