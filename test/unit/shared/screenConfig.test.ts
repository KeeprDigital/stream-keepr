import { describe, expect, it } from 'vitest';
import {
	DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT,
	DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH,
	DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
	DEFAULT_SCREEN_CONFIG,
	getDefaultConfigForMode,
	getDisplayDefaultsForMode,
	mergeScreenModeConfig,
	resolveDeckBoards,
	toModeConfigPatch,
	toScreenConfigPatch,
} from '~~/shared/types/screenConfig';

describe('getDefaultConfigForMode', () => {
	it('returns background config for background mode', () => {
		expect(getDefaultConfigForMode('background')).toEqual({ layers: [] });
	});

	it('returns feature-match config for feature-match mode', () => {
		expect(getDefaultConfigForMode('feature-match')).toMatchObject({
			featureMatchId: null,
			showNames: true,
			leftSidePlayer: 'player1',
			allowCounterControls: true,
		});
	});

	it('returns feature-match-overlay config for feature-match-overlay mode', () => {
		expect(getDefaultConfigForMode('feature-match-overlay')).toEqual(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	});

	it('returns broadcast-graphics config for broadcast-graphics mode', () => {
		expect(getDefaultConfigForMode('broadcast-graphics')).toEqual({ graphics: [] });
	});
});

describe('getDisplayDefaultsForMode', () => {
	it('returns every display default and leaves the Event Reference the Screen points at', () => {
		expect(getDisplayDefaultsForMode('top-cut')).toEqual({
			showSeeds: false,
			showArchetypes: false,
			showHeader: true,
			headerText: undefined,
		});
	});

	it('preserves the authored Background Layer stack on a display reset', () => {
		// Like the Broadcast Graphics stack: authored content with no recovery
		// path, so "Reset to Defaults" must not empty it.
		expect(getDisplayDefaultsForMode('background')).not.toHaveProperty('layers');
	});

	it('returns display defaults that preserve visual settings only', () => {
		expect(getDisplayDefaultsForMode('card')).toMatchObject({
			scale: getDefaultConfigForMode('card').scale,
			animationEnabled: getDefaultConfigForMode('card').animationEnabled,
		});

		expect(getDisplayDefaultsForMode('deck')).toMatchObject({
			board: getDefaultConfigForMode('deck').board,
			mainboard: getDefaultConfigForMode('deck').mainboard,
			sideboard: getDefaultConfigForMode('deck').sideboard,
		});
		expect('deckSource' in getDisplayDefaultsForMode('deck')).toBe(false);

		expect(getDisplayDefaultsForMode('feature-match')).toMatchObject({
			showNames: true,
			showClock: true,
		});

		expect(getDisplayDefaultsForMode('feature-match-overlay')).toMatchObject({
			presetId: DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.presetId,
			layout: {
				frame: DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.frame,
			},
		});

		expect(getDisplayDefaultsForMode('player-history')).toMatchObject({
			columns: getDefaultConfigForMode('player-history').columns,
			showHeader: getDefaultConfigForMode('player-history').showHeader,
		});
	});

	it('preserves the complete Broadcast source while resetting Deck display settings', () => {
		const source = { type: 'broadcast' as const, broadcastDeckListId: 73 };
		const reset = mergeScreenModeConfig(
			{
				deck: {
					...getDefaultConfigForMode('deck'),
					deckSource: source,
					showDeckName: false,
				},
			},
			'deck',
			getDisplayDefaultsForMode('deck'),
		);

		expect(reset.deck?.deckSource).toEqual(source);
		expect(reset.deck?.showDeckName).toBe(getDefaultConfigForMode('deck').showDeckName);
	});
});

describe('resolveDeckBoards', () => {
	it('resolves an empty config to the defaults', () => {
		expect(resolveDeckBoards({})).toEqual({
			board: 'full',
			sideboardPlacement: 'beside',
			mainboard: getDefaultConfigForMode('deck').mainboard,
			sideboard: getDefaultConfigForMode('deck').sideboard,
		});
	});

	it('completes a partial board block from its default block', () => {
		const resolved = resolveDeckBoards({
			board: 'sideboard',
			sideboard: { columns: 6 },
		});

		expect(resolved.board).toBe('sideboard');
		expect(resolved.sideboard).toEqual({
			...getDefaultConfigForMode('deck').sideboard,
			columns: 6,
		});
		expect(resolved.mainboard).toEqual(getDefaultConfigForMode('deck').mainboard);
	});
});

describe('default config constants', () => {
	it('default screen config has center alignment', () => {
		expect(DEFAULT_SCREEN_CONFIG.horizontalAlign).toBe('center');
		expect(DEFAULT_SCREEN_CONFIG.verticalAlign).toBe('center');
		expect(DEFAULT_SCREEN_CONFIG.primaryTextColor).toBeUndefined();
		expect(DEFAULT_SCREEN_CONFIG.secondaryTextColor).toBeUndefined();
	});

	it('default background config starts with an empty layer stack — black until configured', () => {
		expect(getDefaultConfigForMode('background')).toEqual({ layers: [] });
	});

	it('default card config has null featureMatchId', () => {
		expect(getDefaultConfigForMode('card').featureMatchId).toBeNull();
	});

	it('default deck config selects no Player', () => {
		expect(getDefaultConfigForMode('deck').deckSource).toEqual({ type: 'player', playerId: null });
	});

	it('default deck config shows the full deck with per-board layout blocks', () => {
		expect(getDefaultConfigForMode('deck').board).toBe('full');
		expect(getDefaultConfigForMode('deck').sideboardPlacement).toBe('beside');
		expect(getDefaultConfigForMode('deck').mainboard).toEqual({
			view: 'grid',
			columns: 4,
			listColumns: 2,
			cardSize: 'medium',
			dynamicCardSize: false,
			cardGap: 8,
			stackOverlap: 15,
		});
		expect(getDefaultConfigForMode('deck').sideboard).toEqual({
			view: 'stack',
			columns: 4,
			listColumns: 2,
			cardSize: 'medium',
			dynamicCardSize: false,
			cardGap: 8,
			stackOverlap: 15,
		});
	});

	it('default deck config includes Highlander display defaults', () => {
		expect(getDefaultConfigForMode('deck').showDeckMetaPill).toBe(true);
		expect(getDefaultConfigForMode('deck').deckMetaPillSize).toBe('medium');
		expect(getDefaultConfigForMode('deck').deckMetaPillTextColor).toBe('#111827');
		expect(getDefaultConfigForMode('deck').deckMetaPillBgColor).toBe('#ffffff');
		expect(getDefaultConfigForMode('deck').deckMetaPillAccentColor).toBe('#7c3aed');
		expect(getDefaultConfigForMode('deck').showHighlanderTotal).toBe(true);
		expect(getDefaultConfigForMode('deck').showHighlanderPointedCards).toBe(true);
		expect(getDefaultConfigForMode('deck').showHighlanderPoints).toBe(true);
		expect(getDefaultConfigForMode('deck').highlanderPointedCardsSize).toBe('medium');
		expect(getDefaultConfigForMode('deck').highlanderPointedCardsTextColor).toBe('#111827');
		expect(getDefaultConfigForMode('deck').highlanderPointedCardsBgColor).toBe('#ffffff');
		expect(getDefaultConfigForMode('deck').highlanderPointedCardsAccentColor).toBe('#7c3aed');
		expect(getDefaultConfigForMode('deck').highlanderPointedCardsBorderColor).toBeUndefined();
		expect(getDefaultConfigForMode('deck').highlanderPointsPosition).toBe('top-left');
		expect(getDefaultConfigForMode('deck').highlanderPointsSize).toBe('medium');
	});

	it('default feature match config has null featureMatchId', () => {
		expect(getDefaultConfigForMode('feature-match').featureMatchId).toBeNull();
	});

	it('default feature match overlay config has disabled frame media playback', () => {
		expect(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.frame.mediaBackground).toMatchObject({
			enabled: false,
			source: { kind: 'url', url: '' },
			playbackRate: 1,
			loop: true,
		});
	});

	it('default broadcast graphics canvas is 1920 by 1080 pixels', () => {
		expect(DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH).toBe(1920);
		expect(DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT).toBe(1080);
	});

	it('never resets a Broadcast Graphics Screen\'s authored stack to defaults', () => {
		const displayDefaults = getDisplayDefaultsForMode('broadcast-graphics');

		expect('graphics' in displayDefaults).toBe(false);
		expect(getDefaultConfigForMode('broadcast-graphics').graphics).toEqual([]);
	});

	it('still resets a Feature Match Layout, which returns to a recoverable preset', () => {
		const displayDefaults = getDisplayDefaultsForMode('feature-match-overlay');

		expect('layout' in displayDefaults).toBe(true);
		expect(displayDefaults.layout?.sources.length).toBeGreaterThan(0);
		expect(displayDefaults.layout?.composition.items.length).toBeGreaterThan(0);
	});

	it('default standings config defaults to all view mode', () => {
		expect(getDefaultConfigForMode('standings').viewMode).toBe('all');
	});

	it('default standings config hides archetype colors by default', () => {
		expect(getDefaultConfigForMode('standings').showArchetypeColors).toBe(false);
	});

	it('default standings config leaves max table width uncapped by default', () => {
		expect(getDefaultConfigForMode('standings').maxTableWidth).toBeUndefined();
	});

	it('default standings config defaults to current standings', () => {
		expect(getDefaultConfigForMode('standings').roundId).toBeUndefined();
	});

	it('default metagame config defaults to archetype view mode', () => {
		expect(getDefaultConfigForMode('metagame').viewMode).toBe('archetype');
	});

	it('default metagame config defaults to all scope', () => {
		expect(getDefaultConfigForMode('metagame').scope).toBe('all');
	});

	it('default metagame config includes archetype columns with colors and Conversion Rate off by default', () => {
		expect(getDefaultConfigForMode('metagame').archetypeColumns).toEqual([
			{ key: 'archetype', visible: true },
			{ key: 'count', visible: true },
			{ key: 'metaShare', visible: true },
			{ key: 'winRate', visible: true },
			{ key: 'avgPlace', visible: false },
			{ key: 'colors', visible: false },
			{ key: 'conversionRate', visible: false },
		]);
	});

	it('default metagame Conversion Rate target is a Top 8 placement, as on the Metagame page', () => {
		const config = getDefaultConfigForMode('metagame');
		expect({ metric: config.conversionMetric, threshold: config.conversionThreshold })
			.toEqual({ metric: 'topN', threshold: 8 });
	});

	it('default metagame config includes card columns with main and side visible', () => {
		expect(getDefaultConfigForMode('metagame').cardColumns).toEqual([
			{ key: 'card', visible: true },
			{ key: 'manaCost', visible: true },
			{ key: 'type', visible: true },
			{ key: 'inclusionRate', visible: true },
			{ key: 'avgCopies', visible: true },
			{ key: 'totalCopies', visible: true },
			{ key: 'deckCount', visible: true },
			{ key: 'mainboardCount', visible: true },
			{ key: 'sideboardCount', visible: true },
		]);
	});
});

/**
 * An edit as it crosses the wire (#703): a field it names as cleared is sent as the
 * `null` that deletes it, because JSON omits `undefined` and the server reads an
 * omitted field as unchanged. A field it does not name stays omitted.
 */
describe('toModeConfigPatch', () => {
	it('sends a cleared field as a deletion and leaves every field it does not name out', () => {
		expect(toModeConfigPatch('metagame', { archetypeFilter: undefined, headerText: null, topN: 16 }))
			.toEqual({ archetypeFilter: null, headerText: null, topN: 16 });
	});

	it('never deletes an authored stack, which leaves it out instead (ADR-0037)', () => {
		// @ts-expect-error An authored stack's edit takes no null: its PATCH form refuses one.
		toModeConfigPatch('background', { layers: null });
		// @ts-expect-error The Broadcast Graphics stack is authored too.
		toModeConfigPatch('broadcast-graphics', { graphics: null });
		expect(toModeConfigPatch('background', { layers: undefined })).toEqual({});
		expect(toModeConfigPatch('broadcast-graphics', { graphics: undefined, channels: undefined }))
			.toEqual({ channels: null });
	});

	it('sends a mode\'s Background Layer stack cleared as a deletion, as before', () => {
		expect(toModeConfigPatch('metagame', { backgroundLayers: undefined })).toEqual({ backgroundLayers: null });
	});
});

describe('toScreenConfigPatch', () => {
	it('sends a cleared field as a deletion', () => {
		expect(toScreenConfigPatch({ width: undefined, background: '#fff' })).toEqual({ width: null, background: '#fff' });
	});
});
