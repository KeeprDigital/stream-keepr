import { describe, expect, it } from 'vitest';
import {
	DEFAULT_BACKGROUND_CONFIG,
	DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT,
	DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH,
	DEFAULT_BROADCAST_GRAPHICS_CONFIG,
	DEFAULT_CARD_CONFIG,
	DEFAULT_DECK_CONFIG,
	DEFAULT_FEATURE_MATCH_CONFIG,
	DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
	DEFAULT_METAGAME_CONFIG,
	DEFAULT_PLAYER_HISTORY_CONFIG,
	DEFAULT_SCREEN_CONFIG,
	DEFAULT_STANDINGS_CONFIG,
	DEFAULT_TOPCUT_CONFIG,
	getDefaultConfigForMode,
	getDisplayDefaultsForMode,
} from '~~/shared/types/screenConfig';

describe('getDefaultConfigForMode', () => {
	it('returns background config for background mode', () => {
		expect(getDefaultConfigForMode('background')).toEqual(DEFAULT_BACKGROUND_CONFIG);
	});

	it('returns card config for card mode', () => {
		expect(getDefaultConfigForMode('card')).toEqual(DEFAULT_CARD_CONFIG);
	});

	it('returns deck config for deck mode', () => {
		expect(getDefaultConfigForMode('deck')).toEqual(DEFAULT_DECK_CONFIG);
	});

	it('returns standings config for standings mode', () => {
		expect(getDefaultConfigForMode('standings')).toEqual(DEFAULT_STANDINGS_CONFIG);
	});

	it('returns topCut config for topCut mode', () => {
		expect(getDefaultConfigForMode('topCut')).toEqual(DEFAULT_TOPCUT_CONFIG);
	});

	it('returns feature-match config for feature-match mode', () => {
		expect(getDefaultConfigForMode('feature-match')).toEqual(DEFAULT_FEATURE_MATCH_CONFIG);
	});

	it('returns feature-match-overlay config for feature-match-overlay mode', () => {
		expect(getDefaultConfigForMode('feature-match-overlay')).toEqual(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	});

	it('returns broadcast-graphics config for broadcast-graphics mode', () => {
		expect(getDefaultConfigForMode('broadcast-graphics')).toEqual(DEFAULT_BROADCAST_GRAPHICS_CONFIG);
	});

	it('returns metagame config for metagame mode', () => {
		expect(getDefaultConfigForMode('metagame')).toEqual(DEFAULT_METAGAME_CONFIG);
	});

	it('returns player-history config for player-history mode', () => {
		expect(getDefaultConfigForMode('player-history')).toEqual(DEFAULT_PLAYER_HISTORY_CONFIG);
	});
});

describe('getDisplayDefaultsForMode', () => {
	it('returns full config for modes without data bindings', () => {
		expect(getDisplayDefaultsForMode('topCut')).toEqual(DEFAULT_TOPCUT_CONFIG);
	});

	it('preserves the authored Background Layer stack on a display reset', () => {
		// Like the Broadcast Graphics stack: authored content with no recovery
		// path, so "Reset to Defaults" must not empty it.
		expect(getDisplayDefaultsForMode('background')).not.toHaveProperty('layers');
	});

	it('returns display defaults that preserve visual settings only', () => {
		expect(getDisplayDefaultsForMode('card')).toMatchObject({
			scale: DEFAULT_CARD_CONFIG.scale,
			animationEnabled: DEFAULT_CARD_CONFIG.animationEnabled,
		});

		expect(getDisplayDefaultsForMode('deck')).toMatchObject({
			board: DEFAULT_DECK_CONFIG.board,
			mainboard: DEFAULT_DECK_CONFIG.mainboard,
			sideboard: DEFAULT_DECK_CONFIG.sideboard,
		});
		expect('playerId' in getDisplayDefaultsForMode('deck')).toBe(false);

		expect(getDisplayDefaultsForMode('feature-match')).toMatchObject({
			showNames: DEFAULT_FEATURE_MATCH_CONFIG.showNames,
			showClock: DEFAULT_FEATURE_MATCH_CONFIG.showClock,
		});

		expect(getDisplayDefaultsForMode('feature-match-overlay')).toMatchObject({
			presetId: DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.presetId,
			layout: {
				frame: DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.frame,
			},
		});

		expect(getDisplayDefaultsForMode('player-history')).toMatchObject({
			columns: DEFAULT_PLAYER_HISTORY_CONFIG.columns,
			showHeader: DEFAULT_PLAYER_HISTORY_CONFIG.showHeader,
		});
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
		expect(DEFAULT_BACKGROUND_CONFIG).toEqual({ layers: [] });
	});

	it('default card config has null featureMatchId', () => {
		expect(DEFAULT_CARD_CONFIG.featureMatchId).toBeNull();
	});

	it('default deck config has null playerId', () => {
		expect(DEFAULT_DECK_CONFIG.playerId).toBeNull();
	});

	it('default deck config shows the full deck with per-board layout blocks', () => {
		expect(DEFAULT_DECK_CONFIG.board).toBe('full');
		expect(DEFAULT_DECK_CONFIG.sideboardPlacement).toBe('beside');
		expect(DEFAULT_DECK_CONFIG.mainboard).toEqual({
			view: 'grid',
			columns: 4,
			listColumns: 2,
			cardSize: 'medium',
			dynamicCardSize: false,
			cardGap: 8,
			stackOverlap: 15,
		});
		expect(DEFAULT_DECK_CONFIG.sideboard).toEqual({
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
		expect(DEFAULT_DECK_CONFIG.showDeckMetaPill).toBe(true);
		expect(DEFAULT_DECK_CONFIG.deckMetaPillSize).toBe('medium');
		expect(DEFAULT_DECK_CONFIG.deckMetaPillTextColor).toBe('#111827');
		expect(DEFAULT_DECK_CONFIG.deckMetaPillBgColor).toBe('#ffffff');
		expect(DEFAULT_DECK_CONFIG.deckMetaPillAccentColor).toBe('#7c3aed');
		expect(DEFAULT_DECK_CONFIG.showHighlanderTotal).toBe(true);
		expect(DEFAULT_DECK_CONFIG.showHighlanderPointedCards).toBe(true);
		expect(DEFAULT_DECK_CONFIG.showHighlanderPoints).toBe(true);
		expect(DEFAULT_DECK_CONFIG.highlanderPointedCardsSize).toBe('medium');
		expect(DEFAULT_DECK_CONFIG.highlanderPointedCardsTextColor).toBe('#111827');
		expect(DEFAULT_DECK_CONFIG.highlanderPointedCardsBgColor).toBe('#ffffff');
		expect(DEFAULT_DECK_CONFIG.highlanderPointedCardsAccentColor).toBe('#7c3aed');
		expect(DEFAULT_DECK_CONFIG.highlanderPointedCardsBorderColor).toBeUndefined();
		expect(DEFAULT_DECK_CONFIG.highlanderPointsPosition).toBe('top-left');
		expect(DEFAULT_DECK_CONFIG.highlanderPointsSize).toBe('medium');
	});

	it('default feature match config has null featureMatchId', () => {
		expect(DEFAULT_FEATURE_MATCH_CONFIG.featureMatchId).toBeNull();
	});

	it('default feature match overlay config has disabled frame media playback', () => {
		expect(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.frame.mediaBackground).toMatchObject({
			enabled: false,
			type: 'video',
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
		expect(DEFAULT_STANDINGS_CONFIG.viewMode).toBe('all');
	});

	it('default standings config hides archetype colors by default', () => {
		expect(DEFAULT_STANDINGS_CONFIG.showArchetypeColors).toBe(false);
	});

	it('default standings config leaves max table width uncapped by default', () => {
		expect(DEFAULT_STANDINGS_CONFIG.maxTableWidth).toBeUndefined();
	});

	it('default standings config defaults to current standings', () => {
		expect(DEFAULT_STANDINGS_CONFIG.roundId).toBeUndefined();
	});

	it('default metagame config defaults to archetype view mode', () => {
		expect(DEFAULT_METAGAME_CONFIG.viewMode).toBe('archetype');
	});

	it('default metagame config defaults to all scope', () => {
		expect(DEFAULT_METAGAME_CONFIG.scope).toBe('all');
	});

	it('default metagame config includes archetype columns with colors off by default', () => {
		expect(DEFAULT_METAGAME_CONFIG.archetypeColumns).toEqual([
			{ key: 'archetype', visible: true },
			{ key: 'count', visible: true },
			{ key: 'metaShare', visible: true },
			{ key: 'winRate', visible: true },
			{ key: 'avgPlace', visible: false },
			{ key: 'colors', visible: false },
		]);
	});

	it('default metagame config includes card columns with main and side visible', () => {
		expect(DEFAULT_METAGAME_CONFIG.cardColumns).toEqual([
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
