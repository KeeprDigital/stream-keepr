import type { GraphicBindingDataSet } from '~~/shared/modules/graphics';
import { describe, expect, it } from 'vitest';
import {
	bindableGraphicBindingFields,
	createEmptyGraphicBindingDataSet,
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

	it('offers each fixed Talent Social Profile as a compatible handle and canonical URL text field', () => {
		expect(graphicBindingFields('talent', 'mtg').map(field => ({
			id: field.id,
			label: field.label,
			type: field.type,
			shape: field.shape,
		}))).toEqual([
			{ id: 'talent.name', label: 'Name', type: 'text', shape: 'atomic' },
			{ id: 'talent.twitchHandle', label: 'Twitch handle', type: 'text', shape: 'atomic' },
			{ id: 'talent.twitchProfileUrl', label: 'Twitch profile URL', type: 'text', shape: 'formatted' },
			{ id: 'talent.youtubeHandle', label: 'YouTube handle', type: 'text', shape: 'atomic' },
			{ id: 'talent.youtubeProfileUrl', label: 'YouTube profile URL', type: 'text', shape: 'formatted' },
			{ id: 'talent.xHandle', label: 'X handle', type: 'text', shape: 'atomic' },
			{ id: 'talent.xProfileUrl', label: 'X profile URL', type: 'text', shape: 'formatted' },
			{ id: 'talent.instagramHandle', label: 'Instagram handle', type: 'text', shape: 'atomic' },
			{ id: 'talent.instagramProfileUrl', label: 'Instagram profile URL', type: 'text', shape: 'formatted' },
			{ id: 'talent.tiktokHandle', label: 'TikTok handle', type: 'text', shape: 'atomic' },
			{ id: 'talent.tiktokProfileUrl', label: 'TikTok profile URL', type: 'text', shape: 'formatted' },
			{ id: 'talent.blueskyHandle', label: 'Bluesky handle', type: 'text', shape: 'atomic' },
			{ id: 'talent.blueskyProfileUrl', label: 'Bluesky profile URL', type: 'text', shape: 'formatted' },
		]);

		expect(bindableGraphicBindingFields('talent', 'text', 'mtg').common).toHaveLength(13);
		expect(bindableGraphicBindingFields('talent', 'number', 'mtg')).toEqual({ common: [], gameSpecific: [] });
	});

	it('resolves fixed Talent Social Profile handles and canonical URLs without substituting missing profiles', () => {
		const talent = {
			name: 'Jules Kim',
			socialProfiles: { twitch: 'JulesLive', bluesky: 'jules.bsky.social' },
		};

		expect(resolveGraphicBindingField('talent', 'talent.twitchHandle', talent, dataSet())).toBe('JulesLive');
		expect(resolveGraphicBindingField('talent', 'talent.twitchProfileUrl', talent, dataSet()))
			.toBe('https://www.twitch.tv/JulesLive');
		expect(resolveGraphicBindingField('talent', 'talent.blueskyProfileUrl', talent, dataSet()))
			.toBe('https://bsky.app/profile/jules.bsky.social');
		expect(resolveGraphicBindingField('talent', 'talent.youtubeHandle', talent, dataSet()))
			.toBeUndefined();
		expect(resolveGraphicBindingField('talent', 'talent.youtubeProfileUrl', talent, dataSet()))
			.toBeUndefined();
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

/**
 * What an authoring surface may offer one Graphic Input, which is the catalog's two
 * rules asked as one question: the type this input can hold, and this Event's game.
 */
describe('the fields one Graphic Input may bind to', () => {
	it('offers only fields of the Graphic Input\'s own type', () => {
		const text = bindableGraphicBindingFields('player', 'text', 'mtg');
		const number = bindableGraphicBindingFields('player', 'number', 'mtg');

		expect(text.common.map(field => field.id)).toContain('player.record');
		expect(text.common.map(field => field.id)).not.toContain('player.wins');
		expect(number.common.map(field => field.id)).toContain('player.wins');
		expect(number.common.map(field => field.id)).not.toContain('player.record');
	});

	it('presents this Event\'s game-specific fields apart from the common ones', () => {
		const mtg = bindableGraphicBindingFields('player', 'text', 'mtg');

		expect(mtg.common.map(field => field.id)).toContain('player.name');
		expect(mtg.common.every(field => field.game === undefined)).toBe(true);
		expect(mtg.gameSpecific.map(field => field.id)).toEqual(['player.deckName', 'player.deckColors']);
		expect(bindableGraphicBindingFields('player', 'text', 'op').gameSpecific.map(field => field.id))
			.toEqual(['player.leader']);
	});

	it('offers nothing at all where the kind has no field of that type', () => {
		// A Talent has a name and nothing else, so a number Graphic Input has nothing to
		// bind to and the surface has a reason to state rather than an empty picker.
		expect(bindableGraphicBindingFields('talent', 'number', 'mtg')).toEqual({ common: [], gameSpecific: [] });
	});
});

/**
 * The empty set every resolution starts from, pinned as fresh per call.
 *
 * `server/services/graphicBindingData.ts` builds one request's set by assigning
 * straight into the sub-maps this factory returns — `Object.assign(data.players, …)`
 * and six siblings — so a call that handed back a shared object would leave one
 * Event's entities in the next Event's set. The bleed is silent and it reaches air:
 * a selection naming Player 7 in Event B finds `players.findById(7, eventB)`
 * undefined, assigns nothing over the id, and resolves to the Player Event A left
 * there (#366).
 *
 * Nothing else pins it. Measured on #361's row A3, replacing this factory's body
 * with a shared module-level object survived all 24 tests of the bindings
 * integration suite. The shape follows the `carriedForwardBroadcastGraphicsLiveState`
 * aliasing pin in `broadcastGraphicsRecovery.test.ts` (#348).
 */
describe('the empty Graphic Binding Data Set a resolution starts from', () => {
	it('gives every call its own set, and every sub-map its own object to be assigned into', () => {
		const first = createEmptyGraphicBindingDataSet();
		const second = createEmptyGraphicBindingDataSet();

		// A memoized or hoisted-to-a-constant factory lands here.
		expect(first).not.toBe(second);

		// Sub-map identity is the stronger property and needs its own assertions: an
		// edit that shared only the empty sub-maps would keep the two sets distinct
		// and still bleed, because every write the consumer makes goes through them.
		// Derived from the set itself so a sub-map added later is covered without
		// this pin being revisited; the count guards against a loop over nothing.
		type SubMap = Exclude<keyof GraphicBindingDataSet, 'event'>;
		const subMaps = Object.keys(first).filter((key): key is SubMap => key !== 'event');
		expect(subMaps.length, 'no sub-maps to check — the Data Set shape changed').toBeGreaterThan(0);

		for (const subMap of subMaps) {
			Object.assign(first[subMap], { 7: { name: `Event A ${subMap}` } });
			expect(second[subMap], `${subMap} is shared between two Data Sets`).toEqual({});
		}
	});
});
