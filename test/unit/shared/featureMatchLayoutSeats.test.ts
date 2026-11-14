import type { GraphicItemConfig } from '~~/shared/types/graphics';
import type { FeatureMatchSourceRole } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES } from '~~/shared/builtInFeatureMatchLayoutTemplates';
import { createFeatureMatchLayoutComposition } from '~~/shared/featureMatchLayoutComposition';
import { isFeatureMatchLayoutOfferedTo, isFourSeatFeatureMatchLayout } from '~~/shared/featureMatchLayoutSeats';
import { getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

// A layout's content decides which Events it is for: a third or fourth Seat, or a Commander term, makes it four-Seat (ADR-0087).

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };
function make(kind: Parameters<typeof getGraphicItemDefinition>[0], fields: object = {}) {
	return ({
		...getGraphicItemDefinition(kind).createDefault({ id: kind, label: kind, ...CANVAS }),
		...fields,
	}) as GraphicItemConfig;
}

function layout(items: GraphicItemConfig[], roles: FeatureMatchSourceRole[] = ['main', 'player1', 'player2']) {
	const [source] = DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.sources;
	return {
		sources: roles.map((sourceRole, index) => ({ ...source!, id: `source-${index}`, sourceRole })),
		composition: {
			...createFeatureMatchLayoutComposition(),
			items,
		},
	};
}

describe('a four-Seat Feature Match Layout', () => {
	it.each([
		{
			name: 'a Source Item for a third Seat',
			build: () => layout([], ['main', 'player3']),
			fourSeat: true,
		},
		{
			name: 'a Player Life item reading a fourth Seat',
			build: () => layout([
				make('player-life', { playerSide: 'player4' }),
			]),
			fourSeat: true,
		},
		{
			name: 'text naming a third Seat\'s token',
			build: () => layout([
				make('text', { text: '{player3Name}' }),
			]),
			fourSeat: true,
		},
		{
			name: 'text naming a Commander\'s image on the first Seat',
			build: () => layout([
				make('text', { text: '{player1Commander1Image}' }),
			]),
			fourSeat: true,
		},
		{
			name: 'a Graphic Placeholder Style keyed by a fourth Seat\'s token',
			build: () => layout([
				make('text', {
					text: 'x',
					placeholderStyles: { player4Deck: {} },
				}),
			]),
			fourSeat: true,
		},
		{
			name: 'a Commander Damage item on the first Seat',
			build: () => layout([
				make('commander-damage'),
			]),
			fourSeat: true,
		},
		{
			name: 'an Eliminated indicator on the first Seat',
			build: () => layout([
				make('seat-indicator', { state: 'eliminated' }),
			]),
			fourSeat: true,
		},
		{
			name: 'a term inside a Graphic Group',
			build: () => layout([
				make('group', {
					children: [
						make('player-life', { playerSide: 'player3' }),
					],
				}),
			]),
			fourSeat: true,
		},
		{
			name: 'an Active indicator on the second Seat',
			build: () => layout([
				make('seat-indicator', { playerSide: 'player2' }),
			]),
			fourSeat: false,
		},
		{
			name: 'the pair\'s tokens, life, wins and Sideboard',
			build: () => layout([
				make('text', { text: '{player1Name} {player2Record} {eventName}' }),
				make('player-life'),
				make('game-wins'),
				make('deck-list'),
			]),
			fourSeat: false,
		},
	])('reads $name as four-Seat: $fourSeat', ({ build, fourSeat }) => {
		expect(isFourSeatFeatureMatchLayout(build())).toBe(fourSeat);
	});

	it.each([
		{
			kind: 'mtg-two-player' as const,
			offered: ['full-table', 'left-stacked-player-cams', 'neon-feature-match'],
		},
		{
			kind: 'mtg-commander' as const,
			offered: ['commander-table'],
		},
	])('offers a $kind Event the built-ins $offered', ({ kind, offered }) => {
		expect(BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES
			.filter(template => isFeatureMatchLayoutOfferedTo(template.config.layout, kind))
			.map(template => template.id)).toEqual(offered);
	});
});
