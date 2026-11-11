import type { FeatureMatchLayoutEditorLayer } from '~~/app/modules/feature-match-overlay/editorSelection';
import { describe, expect, it } from 'vitest';
import { FEATURE_MATCH_LAYOUT_EDITOR_TREE } from '~~/app/modules/feature-match-overlay/editorHost';
import { layerGroupRefusal } from '~~/app/modules/graphics/editor/layerGrouping';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

/**
 * Which selections ⌘G groups (#920): two or more top-level Graphic Items. A Source
 * Item is host-owned and never joins a Graphic Group (E8), whatever else is selected.
 */

const item = (itemId: string): FeatureMatchLayoutEditorLayer => ({ type: 'item', itemId });
const source = (itemId: string): FeatureMatchLayoutEditorLayer => ({ type: 'source', itemId });

describe('layerGroupRefusal', () => {
	it.each([
		[
			'two top-level Graphic Items',
			[
				item('player2-game-wins'),
				item('player1-game-wins'),
			],
			null,
		],
		[
			'a Source Item with two Graphic Items',
			[
				item('player2-game-wins'),
				source('main-source'),
				item('player1-game-wins'),
			],
			'source-item',
		],
		[
			'a Source Item alone',
			[
				source('main-source'),
			],
			'source-item',
		],
		[
			'one Graphic Item',
			[
				item('player1-game-wins'),
			],
			'too-few',
		],
		[
			'a Graphic Group with a Graphic Item',
			[
				item('top-bar'),
				item('player1-game-wins'),
			],
			'group-into-group',
		],
		[
			'two children of one Graphic Group',
			[
				item('top-name-record'),
				item('top-deck'),
			],
			'group-child',
		],
	] as const)('answers %s', (_case, layers, refusal) => {
		expect(layerGroupRefusal(FEATURE_MATCH_LAYOUT_EDITOR_TREE, DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout, layers)).toBe(refusal);
	});
});
