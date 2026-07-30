import { describe, expect, it } from 'vitest';
import {
	DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT,
	DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH,
	DEFAULT_BROADCAST_GRAPHICS_CONFIG,
	DEFAULT_CARD_CONFIG,
	DEFAULT_DECK_CONFIG,
	DEFAULT_FEATURE_MATCH_CONFIG,
	DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
	DEFAULT_IDLE_CONFIG,
	DEFAULT_METAGAME_CONFIG,
	DEFAULT_PLAYER_HISTORY_CONFIG,
	DEFAULT_SCREEN_CONFIG,
	DEFAULT_STANDINGS_CONFIG,
	DEFAULT_TOPCUT_CONFIG,
	getDefaultConfigForMode,
	getDisplayDefaultsForMode,
} from '~~/shared/types/screenConfig';

describe('getDefaultConfigForMode', () => {
	it('returns idle config for idle mode', () => {
		expect(getDefaultConfigForMode('idle')).toEqual(DEFAULT_IDLE_CONFIG);
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
		expect(getDisplayDefaultsForMode('idle')).toEqual(DEFAULT_IDLE_CONFIG);
		expect(getDisplayDefaultsForMode('topCut')).toEqual(DEFAULT_TOPCUT_CONFIG);
	});

	it('returns display defaults that preserve visual settings only', () => {
		expect(getDisplayDefaultsForMode('card')).toMatchObject({
			scale: DEFAULT_CARD_CONFIG.scale,
			animationEnabled: DEFAULT_CARD_CONFIG.animationEnabled,
		});

		expect(getDisplayDefaultsForMode('deck')).toMatchObject({
			listColumns: DEFAULT_DECK_CONFIG.listColumns,
			showSideboard: DEFAULT_DECK_CONFIG.showSideboard,
		});

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

	it('default idle config has disabled media playback', () => {
		expect(DEFAULT_IDLE_CONFIG.mediaBackground).toMatchObject({
			enabled: false,
			type: 'video',
			playbackRate: 1,
			loop: true,
		});
	});

	it('default card config has null featureMatchId', () => {
		expect(DEFAULT_CARD_CONFIG.featureMatchId).toBeNull();
	});

	it('default deck config has null playerId', () => {
		expect(DEFAULT_DECK_CONFIG.playerId).toBeNull();
	});

	it('default deck config includes Highlander display defaults', () => {
		expect(DEFAULT_DECK_CONFIG.listColumns).toBe(2);
		expect(DEFAULT_DECK_CONFIG.showSideboard).toBe(true);
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

	it('default broadcast graphics config owns an empty Broadcast Graphics stack', () => {
		expect(DEFAULT_BROADCAST_GRAPHICS_CONFIG.graphics).toEqual([]);
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
