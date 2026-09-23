import type { GraphicItemConfig } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import {
	createFeatureMatchLayoutComposition,
	FEATURE_MATCH_LAYOUT_COMPOSITION_ID,
	featureMatchLayoutStack,
} from '~~/shared/featureMatchLayoutComposition';
import { getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { resolveFeatureMatchOverlayCompositorRenderModel } from '~/modules/feature-match-overlay/compositorRenderModel';
import {
	featureMatchGraphicsContext,
	featureMatchTokenValues,
} from '~/modules/feature-match-overlay/tokenValues';

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

function item(kind: 'text' | 'clock' | 'player-life' | 'game-wins', id: string): GraphicItemConfig {
	return getGraphicItemDefinition(kind).createDefault({
		id,
		label: id,
		canvasWidth: 1920,
		canvasHeight: 1080,
	});
}

function layout(items: GraphicItemConfig[]): Pick<FeatureMatchLayoutConfig, 'composition'> {
	return { composition: { ...createFeatureMatchLayoutComposition(), items } };
}

describe('featureMatchLayoutComposition', () => {
	it('creates an empty composition with the one stable id and name', () => {
		// A Feature Match Layout always has a composition — the legacy widget list it
		// used to live beside is gone — so an empty one is what a layout with no
		// Graphic Items yet carries.
		expect(createFeatureMatchLayoutComposition()).toEqual({
			id: FEATURE_MATCH_LAYOUT_COMPOSITION_ID,
			name: 'Feature Match Layout',
			items: [],
		});
	});

	it('passes the one composition to the compositor as a stack of one', () => {
		// A Feature Match Overlay renders exactly one Feature Match Layout, and the
		// shared render model composes a stack. One is a stack.
		expect(featureMatchLayoutStack(layout([item('text', 'name')]))).toHaveLength(1);
	});

	it('keeps the composition id stable, because it scopes every minted element id', () => {
		// A generated id would renumber every gradient and outline clip path between
		// reads for no reason.
		expect(createFeatureMatchLayoutComposition().id).toBe(FEATURE_MATCH_LAYOUT_COMPOSITION_ID);
	});
});

describe('featureMatchOverlayCompositorRenderModel', () => {
	it('composes the one composition without being asked which is on air', () => {
		// There is no playout here and no field for one: no stack, no Graphic Channels,
		// no Take or Out, so nothing selects and no empty set means "nothing on air".
		const model = resolveFeatureMatchOverlayCompositorRenderModel({
			output: 'overlay',
			layout: layout([item('text', 'name')]),
			...CANVAS,
		});

		expect(model.graphics).toHaveLength(1);
		expect(model.graphics[0]!.items).toHaveLength(1);
	});

	it('resolves a Graphic Text Template against the Feature Match token catalogue', () => {
		const model = resolveFeatureMatchOverlayCompositorRenderModel({
			output: 'overlay',
			layout: layout([{ ...item('text', 'name'), text: '{player1Name}' } as GraphicItemConfig]),
			tokenValues: { player1Name: 'Alice' },
			...CANVAS,
		});

		expect(model.graphics[0]!.items[0]!.text).toBe('Alice');
	});

	it('marks only Deck Colours token runs for MTG mana-pip rendering', () => {
		const text = {
			...item('text', 'deck'),
			text: '{player1DeckColors} {player1Deck}',
		} as GraphicItemConfig;
		const overlay = resolveFeatureMatchOverlayCompositorRenderModel({
			output: 'overlay',
			layout: layout([text]),
			tokenValues: { player1DeckColors: 'WU', player1Deck: 'Control' },
			...CANVAS,
		}).graphics[0]!.items[0]!;
		const key = resolveFeatureMatchOverlayCompositorRenderModel({
			output: 'key',
			layout: layout([text]),
			tokenValues: { player1DeckColors: 'WU', player1Deck: 'Control' },
			...CANVAS,
		}).graphics[0]!.items[0]!;

		expect(overlay.text).toBe('WU Control');
		expect(overlay.textSegments?.[0]?.manaColors).toEqual({
			colors: 'WU',
			symbolCount: 2,
			monochrome: false,
		});
		expect(overlay.textSegments?.[2]?.manaColors).toBeUndefined();
		expect(key.textSegments?.[0]?.manaColors?.monochrome).toBe(true);
	});

	it('renders the context-gated Items from the supplied session state', () => {
		const model = resolveFeatureMatchOverlayCompositorRenderModel({
			output: 'overlay',
			layout: layout([item('clock', 'clock'), item('player-life', 'life'), item('game-wins', 'wins')]),
			featureMatch: {
				clockDisplayTime: '4:31',
				player1: { lifeTotal: 12, gameWins: 2, sideboard: null, sideboardRevealed: true },
				player2: { lifeTotal: 20, gameWins: 0, sideboard: null, sideboardRevealed: true },
				bestOf: 3,
			},
			...CANVAS,
		});
		const [clock, life, wins] = model.graphics[0]!.items;

		expect(clock!.text).toBe('4:31');
		expect(life!.text).toBe('12');
		expect(wins!.winBoxes?.map(box => box.won)).toEqual([true, true]);
	});

	it('paints no canvas backdrop of its own in any Screen Output', () => {
		// The composed tree is one layer inside a canvas the Feature Match Overlay
		// already paints, and it is mounted above the Frame and the Source Items. A
		// backdrop here would be a second, opaque copy covering the whole host-owned
		// layer — solid black in the Fill and Key Outputs, which is an on-air failure
		// rather than a cosmetic one.
		for (const output of ['overlay', 'fill', 'key'] as const) {
			const model = resolveFeatureMatchOverlayCompositorRenderModel({
				output,
				layout: layout([]),
				...CANVAS,
			});

			expect(model.canvasStyle.background).toBe('transparent');
			expect(model.graphics[0]!.items).toEqual([]);
		}
	});

	it('leaves the layer in flow rather than establishing its own positioning', () => {
		// The host positions the layer, because the canvas coordinate space belongs to
		// the Screen and the Frame is drawn in the same space. An inline `position`
		// here would override the scoped rule that places it.
		const model = resolveFeatureMatchOverlayCompositorRenderModel({
			output: 'overlay',
			layout: layout([]),
			...CANVAS,
		});

		expect(model.canvasStyle.position).toBeUndefined();
	});

	it('declares itself a layer, so its host draws the one guide layer over it', () => {
		// The same division that decides the backdrop and the placement decides the
		// guides: whoever paints the canvas draws them. Two guide layers stacked over
		// one canvas would leave whichever landed underneath unclickable.
		const model = resolveFeatureMatchOverlayCompositorRenderModel({
			output: 'overlay',
			layout: layout([]),
			...CANVAS,
		});

		expect(model.canvasRole).toBe('layer');
	});

	it('draws no guide of any kind unless an editor preview asks for one', () => {
		// Preview guides never appear in live Screen Outputs or captures. A live output
		// asks for neither flag, so this is the model-level half of that property —
		// checked in every output, because nothing about the output selection changes
		// the answer.
		for (const output of ['overlay', 'fill', 'key'] as const) {
			const model = resolveFeatureMatchOverlayCompositorRenderModel({
				output,
				layout: layout([item('clock', 'clock'), item('game-wins', 'wins')]),
				selectedTarget: { type: 'item', graphicId: FEATURE_MATCH_LAYOUT_COMPOSITION_ID, itemId: 'clock' },
				...CANVAS,
			});

			expect(model.itemGuides).toEqual([]);
			expect(model.safeAreaGuides).toEqual([]);
		}
	});

	it('plays a per-item projection against the one composition"s items (#492)', () => {
		// The host adapter's `itemAnimation` is keyed by Graphic Item id alone —
		// there is exactly one composition, so the adapter nests the map under its
		// stable id the same way it nests the token values.
		const withEnter = {
			...item('text', 'name'),
			animation: { enter: { duration: 400, easing: 'linear' as const, delay: 0, fade: { opacity: 0 } } },
		} as GraphicItemConfig;
		const model = resolveFeatureMatchOverlayCompositorRenderModel({
			output: 'overlay',
			layout: layout([withEnter]),
			itemAnimation: { name: [{ phase: 'enter', elapsed: 200 }] },
			...CANVAS,
		});

		// Halfway through a linear 400ms fade from zero.
		expect(model.graphics[0]!.items[0]!.style.opacity).toBe(0.5);
	});

	it('keeps a hidden sideboard"s Deck List rendering while the host projects its exit', () => {
		// The sideboardRevealed true→false edge: the host supplies the exit
		// projection and the flag-hidden item keeps its cards until the authored
		// motion has carried them off — then, with the projection dropped, the
		// renders-nothing state takes over. The item is on air in both frames.
		const deckListItem = {
			...getGraphicItemDefinition('deck-list').createDefault({
				id: 'side-1',
				label: 'side-1',
				canvasWidth: 1920,
				canvasHeight: 1080,
			}),
			animation: { exit: { duration: 400, easing: 'linear' as const, delay: 0, fade: { opacity: 0 } } },
		} as GraphicItemConfig;
		const hidden = {
			clockDisplayTime: '0:00',
			player1: {
				lifeTotal: null,
				gameWins: 0,
				sideboard: [{ name: 'Rest in Peace', quantity: 2, imageUrl: null }],
				sideboardRevealed: false,
			},
			player2: { lifeTotal: null, gameWins: 0, sideboard: null, sideboardRevealed: false },
			bestOf: 3,
		};
		const at = (itemAnimation?: { 'side-1': [{ phase: 'exit'; elapsed: number }] }) =>
			resolveFeatureMatchOverlayCompositorRenderModel({
				output: 'overlay',
				layout: layout([deckListItem]),
				featureMatch: hidden,
				itemAnimation,
				...CANVAS,
			}).graphics[0]!.items[0]!;

		const leaving = at({ 'side-1': [{ phase: 'exit', elapsed: 200 }] });
		expect(leaving.text).toContain('Rest in Peace');
		expect(leaving.style.opacity).toBe(0.5);

		expect(at().text).toBeUndefined();
	});

	it('guides every shared Graphic Item and marks the selected one, when asked', () => {
		const model = resolveFeatureMatchOverlayCompositorRenderModel({
			output: 'overlay',
			layout: layout([item('clock', 'clock'), item('game-wins', 'wins')]),
			itemGuides: true,
			safeAreaGuides: true,
			selectedTarget: { type: 'item', graphicId: FEATURE_MATCH_LAYOUT_COMPOSITION_ID, itemId: 'wins' },
			...CANVAS,
		});

		expect(model.itemGuides.map(guide => [guide.itemId, guide.selected])).toEqual([
			['clock', false],
			['wins', true],
		]);
		// Advisory action-safe at a five-percent inset, title-safe at ten.
		expect(model.safeAreaGuides.map(guide => guide.id)).toEqual(['action-safe', 'title-safe']);
	});
});

describe('featureMatchTokenValues', () => {
	const HOST_STATE = {
		event: { name: 'Regional', game: 'mtg' as const, displayRecordSeparator: '-', displayHideZeroDraws: true },
		featureMatch: {
			bestOf: 3,
			tableNumber: 4,
			roundName: 'Round 5',
			formatName: 'Modern',
			player1Data: { name: 'Alice', pronouns: 'she/her', lgs: 'Card Shop', wins: 4, losses: 1, draws: 0 },
			player2Data: { name: 'Bo', pronouns: 'they/them', lgs: 'Game Den', wins: 3, losses: 2, draws: 1 },
		},
		matchState: { player1: { lifeTotal: 12, gameWins: 2 }, player2: { lifeTotal: 20, gameWins: 0 } },
		sourceMatch: null,
		round: { name: 'Round 5' },
		phase: { name: 'Swiss' },
		displayTime: '4:31',
	} as unknown as Parameters<typeof featureMatchTokenValues>[0];

	it('writes each player"s values under the side-prefixed catalogue key', () => {
		// The legacy model put the side on the item, so one `{name}` token meant two
		// values. A shared Text Graphic Item has no side, so the side is in the key.
		const values = featureMatchTokenValues(HOST_STATE);

		expect(values.player1Name).toBe('Alice');
		expect(values.player2Name).toBe('Bo');
		expect(values.player1Pronouns).toBe('she/her');
		expect(values.player2Lgs).toBe('Game Den');
	});

	it('formats a record the way the Event displays one', () => {
		const values = featureMatchTokenValues(HOST_STATE);

		// Zero draws are hidden by default, so a 4-1-0 record reads as 4-1.
		expect(values.player1Record).toBe('4-1');
		expect(values.player2Record).toBe('3-2-1');
	});

	it('places formatted positions in the record tokens when position mode is selected', () => {
		const values = featureMatchTokenValues({
			...HOST_STATE,
			event: { ...HOST_STATE.event, displayPositionFormat: 'ordinal' },
			featureMatch: {
				...HOST_STATE.featureMatch,
				playerDisplayMode: 'position',
				player1Data: { ...HOST_STATE.featureMatch?.player1Data, position: 1 },
				player2Data: { ...HOST_STATE.featureMatch?.player2Data, position: 12 },
			},
		} as unknown as Parameters<typeof featureMatchTokenValues>[0]);

		expect(values.player1Record).toBe('1st');
		expect(values.player2Record).toBe('12th');
	});

	it('leaves an absent record empty rather than reporting nothing as 0-0', () => {
		const values = featureMatchTokenValues({
			...HOST_STATE,
			featureMatch: { ...HOST_STATE.featureMatch, player1Data: { name: 'Alice' } },
		} as typeof HOST_STATE);

		expect(values.player1Record).toBe('');
	});

	it('resolves the Match, Round, and Event tokens', () => {
		const values = featureMatchTokenValues(HOST_STATE);

		expect(values).toMatchObject({
			round: 'Round 5',
			stage: 'Swiss',
			table: 'Table 4',
			format: 'Modern',
			eventName: 'Regional',
		});
	});
});

describe('featureMatchGraphicsContext', () => {
	it('prefers the active session"s own best-of over the Slot"s current value', () => {
		// A Match promoted into the Slot mid-session must not change how many win boxes
		// the session in progress draws.
		const context = featureMatchGraphicsContext({
			featureMatch: { bestOf: 3, activeSession: { sourceSnapshot: { bestOf: 5 } } },
			matchState: { player1: { lifeTotal: 12, gameWins: 2, sideboardRevealed: true }, player2: { lifeTotal: 20, gameWins: 0, sideboardRevealed: false } },
			displayTime: '4:31',
		} as unknown as Parameters<typeof featureMatchGraphicsContext>[0]);

		expect(context.bestOf).toBe(5);
		// No resolved deck data supplied: `null`, never a placeholder sideboard.
		expect(context.player1).toEqual({ lifeTotal: 12, gameWins: 2, sideboard: null, sideboardRevealed: true });
		expect(context.player2.sideboardRevealed).toBe(false);
	});

	it('uses the Event Match Format when no Feature Match Slot is bound', () => {
		const context = featureMatchGraphicsContext({
			event: { featureMatchDefaultBestOf: 5 },
			featureMatch: null,
			matchState: null,
			displayTime: '4:31',
		} as unknown as Parameters<typeof featureMatchGraphicsContext>[0]);

		expect(context.bestOf).toBe(5);
	});

	it('joins resolved deck data into each side"s sideboard (#491)', () => {
		// The host resolves sideboard cards client-side; the context carries them
		// per side without the render model ever seeing the full MTG card type.
		const deckData = {
			player1: [{ name: 'Counterspell', quantity: 2, imageUrl: 'https://img.test/counterspell.jpg' }],
			// `null` art is a card that resolved without an image: the placeholder
			// rendering, not an absent sideboard.
			player2: [{ name: 'Duress', quantity: 3, imageUrl: null }],
		};
		const context = featureMatchGraphicsContext({
			featureMatch: null,
			matchState: { player1: { lifeTotal: 12, gameWins: 2, sideboardRevealed: true }, player2: { lifeTotal: 20, gameWins: 0, sideboardRevealed: false } },
			displayTime: '4:31',
		} as unknown as Parameters<typeof featureMatchGraphicsContext>[0], deckData);

		expect(context.player1.sideboard).toEqual(deckData.player1);
		expect(context.player2.sideboard).toEqual(deckData.player2);
	});

	it('keeps null and [] distinct per side: unresolved and genuinely empty', () => {
		// Whole-fetch failure is `null`; a deck whose sideboard holds no cards is
		// `[]`. A Deck List Graphic Item renders nothing for either, but a control
		// surface can tell them apart.
		const context = featureMatchGraphicsContext({
			featureMatch: null,
			matchState: null,
			displayTime: '0:00',
		} as unknown as Parameters<typeof featureMatchGraphicsContext>[0], { player1: null, player2: [] });

		expect(context.player1.sideboard).toBeNull();
		expect(context.player2.sideboard).toEqual([]);
	});

	it('reports an absent life total as absent rather than as zero', () => {
		const context = featureMatchGraphicsContext({
			featureMatch: null,
			matchState: null,
			displayTime: '0:00',
		} as unknown as Parameters<typeof featureMatchGraphicsContext>[0]);

		expect(context.player1.lifeTotal).toBeNull();
		expect(context.player1.gameWins).toBe(0);
		expect(context.bestOf).toBe(3);
	});

	it('treats an absent or legacy session state as sideboards hidden', () => {
		// Default false: nothing shows before an operator reveals it, including on
		// states persisted before the flag existed.
		const absent = featureMatchGraphicsContext({
			featureMatch: null,
			matchState: null,
			displayTime: '0:00',
		} as unknown as Parameters<typeof featureMatchGraphicsContext>[0]);
		expect(absent.player1.sideboardRevealed).toBe(false);
		expect(absent.player2.sideboardRevealed).toBe(false);

		const legacy = featureMatchGraphicsContext({
			featureMatch: null,
			matchState: { player1: { lifeTotal: 20, gameWins: 0 }, player2: { lifeTotal: 20, gameWins: 0 } },
			displayTime: '0:00',
		} as unknown as Parameters<typeof featureMatchGraphicsContext>[0]);
		expect(legacy.player1.sideboardRevealed).toBe(false);
	});
});
