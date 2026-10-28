import { describe, expect, it } from 'vitest';
import {
	DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
	getDefaultConfigForMode,
	getDisplayDefaultsForMode,
	mergeScreenModeConfig,
	resolveDeckBoards,
	toModeConfigPatch,
} from '~~/shared/types/screenConfig';

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
		// Card Spotlight's config is its match binding alone, which a reset keeps.
		expect(getDisplayDefaultsForMode('card')).toEqual({});

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
});

describe('resolveDeckBoards', () => {
	// A mainboard cannot stack (ADR-0053); one stored by a client older than 0014 reads as a grid.
	it('reads a stored mainboard stack as a grid, and leaves a sideboard stack', () => {
		const resolved = resolveDeckBoards({
			mainboard: { view: 'stack' },
			sideboard: { view: 'stack' },
		} as never);

		expect(resolved.mainboard.view).toBe('grid');
		expect(resolved.sideboard.view).toBe('stack');
	});

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
