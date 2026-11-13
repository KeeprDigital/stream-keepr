import type { GraphicItemConfig } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import {
	createFeatureMatchLayoutComposition,
	FEATURE_MATCH_LAYOUT_COMPOSITION_ID,
	featureMatchLayoutStack,
} from '~~/shared/featureMatchLayoutComposition';
import { getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { scryfallCardImageUrl } from '~~/shared/utils/scryfallCardImage';
import { ATRAXA, KRAUM, TYMNA } from '~~/test/helpers/commanders';
import { commanderSnapshot, seatedPlayer } from '~~/test/helpers/featureMatchSnapshots';
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
	return {
		composition: {
			...createFeatureMatchLayoutComposition(),
			items,
		},
	};
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
		expect(featureMatchLayoutStack(layout([
			item('text', 'name'),
		]))).toHaveLength(1);
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
			layout: layout([
				item('text', 'name'),
			]),
			...CANVAS,
		});

		expect(model.graphics).toHaveLength(1);
		expect(model.graphics[0]!.items).toHaveLength(1);
	});

	it('resolves a Graphic Text Template against the Feature Match token catalogue', () => {
		const model = resolveFeatureMatchOverlayCompositorRenderModel({
			output: 'overlay',
			layout: layout([
				{
					...item('text', 'name'),
					text: '{player1Name}',
				} as GraphicItemConfig,
			]),
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
			kind: 'mtg-two-player',
			layout: layout([text]),
			tokenValues: { player1DeckColors: 'WU', player1Deck: 'Control' },
			...CANVAS,
		}).graphics[0]!.items[0]!;
		const key = resolveFeatureMatchOverlayCompositorRenderModel({
			output: 'key',
			kind: 'mtg-two-player',
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

	describe('a One Piece Event\'s Leader', () => {
		const text = {
			...item('text', 'leader'),
			text: '{player1LeaderImage}{player1DeckColors} {player1Deck}',
		} as GraphicItemConfig;
		function segments(output: 'overlay' | 'key', leaderImage: string) {
			return resolveFeatureMatchOverlayCompositorRenderModel({
				output,
				kind: 'op',
				layout: layout([text]),
				tokenValues: { player1LeaderImage: leaderImage, player1DeckColors: 'Red/Green', player1Deck: 'Monkey.D.Luffy' },
				...CANVAS,
			}).graphics[0]!.items[0]!.textSegments!;
		}
		const image = 'https://cards-img.keepr.digital/OP01-003.png';

		it.each([
			{ output: 'overlay' as const, monochrome: false },
			{ output: 'key' as const, monochrome: true },
		])('paints its colours as pips and its card as an image on the $output Output', ({ output, monochrome }) => {
			const [cardImage, colors, , name] = segments(output, image);

			expect(cardImage!.cardImage).toEqual({ url: image, monochrome, alt: 'Leader' });
			expect(colors!.opColors).toEqual({
				colors: ['Red', 'Green'],
				monochrome,
			});
			expect(colors!.manaColors).toBeUndefined();
			expect(name!.text).toBe('Monkey.D.Luffy');
		});

		// Only a bandai-keepr Printing image is loaded on air.
		it('paints any other URL as its text', () => {
			expect(segments('overlay', 'https://example.com/x.png')[0]!.cardImage).toBeUndefined();
		});
	});

	it('renders the context-gated Items from the supplied session state', () => {
		const model = resolveFeatureMatchOverlayCompositorRenderModel({
			output: 'overlay',
			layout: layout([
				item('clock', 'clock'),
				item('player-life', 'life'),
				item('game-wins', 'wins'),
			]),
			featureMatch: {
				clockDisplayTime: '4:31',
				player1: {
					lifeTotal: 12,
					gameWins: 2,
					sideboard: null,
					sideboardRevealed: true,
				},
				player2: {
					lifeTotal: 20,
					gameWins: 0,
					sideboard: null,
					sideboardRevealed: true,
				},
				bestOf: 3,
			},
			...CANVAS,
		});
		const [clock, life, wins] = model.graphics[0]!.items;

		expect(clock!.text).toBe('4:31');
		expect(life!.text).toBe('12');
		expect(wins!.winBoxes?.map(box => box.won)).toEqual([true, true]);
	});

	describe('a Commander Slot', () => {
		const ATRAXA_IMAGE = 'https://cards.scryfall.io/normal/front/d/0/d0d33d52-3d28-4635-b985-51e126289259.jpg';
		const SURFACE = {
			fill: { type: 'solid' as const, color: '#112233' },
			fillOpacity: 1,
		};
		const seatState = (lifeTotal: number | null) => ({
			lifeTotal,
			gameWins: 0,
			sideboard: null,
			sideboardRevealed: false,
		});
		/** Four Seats at 40, 31, 22 and 13 life; `emptySeats` are the ones nobody sits in. */
		function commanderContext(emptySeats: Array<'player1' | 'player2' | 'player3' | 'player4'> = []) {
			return {
				clockDisplayTime: null,
				player1: seatState(40),
				player2: seatState(31),
				player3: seatState(22),
				player4: seatState(13),
				emptySeats,
				bestOf: 1,
			};
		}
		function items(layoutItems: GraphicItemConfig[], emptySeats: Parameters<typeof commanderContext>[0] = [], output: 'overlay' | 'key' = 'overlay') {
			return resolveFeatureMatchOverlayCompositorRenderModel({
				output,
				kind: 'mtg-commander',
				layout: layout(layoutItems),
				tokenValues: {
					player1Name: 'Ana',
					player3Name: '',
					player3Commander1Image: '',
					player4Name: 'Dara',
					player4Commander1Image: ATRAXA_IMAGE,
					player4Commander2Image: 'https://example.com/x.jpg',
					eventName: 'Commander Night',
				},
				featureMatch: commanderContext(emptySeats),
				...CANVAS,
			}).graphics[0]!.items;
		}
		const life = (seat: 'player1' | 'player2' | 'player3' | 'player4', id = `life-${seat}`) =>
			({
				...item('player-life', id),
				playerSide: seat,
				surfaceStyle: SURFACE,
			}) as GraphicItemConfig;
		const text = (template: string, id = 'text') =>
			({
				...item('text', id),
				text: template,
				surfaceStyle: SURFACE,
			}) as GraphicItemConfig;
		const group = (children: GraphicItemConfig[]) =>
			({
				...getGraphicItemDefinition('group').createDefault({ id: 'plate', label: 'plate', ...CANVAS }),
				surfaceStyle: SURFACE,
				children,
			}) as GraphicItemConfig;

		it.each([
			{ seat: 'player3' as const, life: '22' },
			{ seat: 'player4' as const, life: '13' },
		])('renders $seat\'s life total in a Player Life Graphic Item reading it', ({ seat, life: total }) => {
			expect(items([
				life(seat),
			])[0]!.text).toBe(total);
		});

		it.each([
			{ output: 'overlay' as const, monochrome: false },
			{ output: 'key' as const, monochrome: true },
		])('paints a Commander\'s card as an image on the $output Output', ({ output, monochrome }) => {
			const [segment] = items([
				text('{player4Commander1Image}'),
			], [], output)[0]!.textSegments!;

			expect(segment!.cardImage).toEqual({ url: ATRAXA_IMAGE, monochrome, alt: 'Commander' });
		});

		// Only a Scryfall card image is loaded on air.
		it('paints any other URL as its text', () => {
			expect(items([
				text('{player4Commander2Image}'),
			])[0]!.textSegments![0]!.cardImage).toBeUndefined();
		});

		/** Whether an item paints nothing: no surface, no text and no children. */
		function paintsNothing(descriptor: { surface?: unknown; text?: unknown; children?: unknown } | undefined) {
			return descriptor !== undefined && descriptor.surface === undefined && descriptor.text === undefined && descriptor.children === undefined;
		}

		// An empty Seat's Graphic Items render nothing, surface included (ADR-0087).
		it.each([
			{
				name: 'a Player Life item reading it',
				build: () => [
					life('player3'),
				],
				nothing: [true],
			},
			{
				name: 'text naming only its tokens',
				build: () => [
					text('{player3Name} {player3Commander1Image}'),
				],
				nothing: [true],
			},
			{
				name: 'text naming it and a filled Seat',
				build: () => [
					text('{player1Name} vs {player3Name}'),
				],
				nothing: [false],
			},
			{
				name: 'text naming no Seat',
				build: () => [
					text('{eventName}'),
				],
				nothing: [false],
			},
			{
				name: 'a group whose children read only it',
				build: () => [
					group([
						life('player3'),
						text('{player3Name}'),
					]),
				],
				nothing: [true],
			},
			{
				name: 'a filled Seat\'s items beside it',
				build: () => [
					life('player4'),
					text('{player4Name}'),
				],
				nothing: [false, false],
			},
			{
				name: 'a group whose only visible child reads it',
				build: () => [
					group([
						text('{player3Name}'),
						{
							...life('player4'),
							visible: false,
						},
					]),
				],
				nothing: [true],
			},
		])('renders nothing for $name: $nothing', ({ build, nothing }) => {
			expect(items(build(), ['player3']).map(paintsNothing)).toEqual(nothing);
		});

		// One count per opposing Commander, in Seat order, each beside its card and hidden while zero (ADR-0087).
		describe('a Commander Damage item', () => {
			const damage = (seat: 'player1' | 'player2') =>
				({
					...getGraphicItemDefinition('commander-damage').createDefault({ id: 'damage', label: 'damage', ...CANVAS }),
					playerSide: seat,
					surfaceStyle: SURFACE,
				}) as GraphicItemConfig;
			function rendered(counts: Array<{ damage: number; imageUrl: string | null }>, output: 'overlay' | 'key' = 'overlay') {
				return resolveFeatureMatchOverlayCompositorRenderModel({
					output,
					kind: 'mtg-commander',
					layout: layout([
						damage('player2'),
					]),
					featureMatch: {
						...commanderContext(),
						player2: {
							...seatState(31),
							commanderDamage: counts,
						},
					},
					...CANVAS,
				}).graphics[0]!.items[0]!;
			}

			it('shows each count taken beside its Commander\'s card, and leaves out one still at zero', () => {
				const item = rendered([
					{ damage: 5, imageUrl: ATRAXA_IMAGE },
					{ damage: 0, imageUrl: ATRAXA_IMAGE },
					{ damage: 21, imageUrl: null },
				]);

				expect(item.text).toBe(`${ATRAXA_IMAGE}5 21`);
				expect(item.textSegments!.map(segment => segment.cardImage?.url ?? segment.text)).toEqual([ATRAXA_IMAGE, '5', ' ', '21']);
				expect(item.surface).toBeDefined();
			});

			it('paints its cards as coverage on the Key Output', () => {
				expect(rendered([
					{ damage: 5, imageUrl: ATRAXA_IMAGE },
				], 'key').textSegments![0]!.cardImage).toMatchObject({ monochrome: true });
			});

			it.each([
				{
					name: 'every count is zero',
					counts: [
						{ damage: 0, imageUrl: ATRAXA_IMAGE },
					],
				},
				{ name: 'no opposing Seat holds a Commander', counts: [] },
			])('paints nothing while $name', ({ counts }) => {
				expect(paintsNothing(rendered(counts))).toBe(true);
			});
		});

		// Shown only while its Seat is in the state its author picked (ADR-0087).
		describe('a Seat Indicator item', () => {
			const indicator = (seat: 'player1' | 'player2', state: 'active' | 'eliminated') =>
				({
					...getGraphicItemDefinition('seat-indicator').createDefault({ id: 'indicator', label: 'indicator', ...CANVAS }),
					playerSide: seat,
					state,
				}) as GraphicItemConfig;
			function rendered(item: GraphicItemConfig, live: { activeSeat?: 'player1' | 'player2' | null; eliminated?: boolean }, exiting = false) {
				return resolveFeatureMatchOverlayCompositorRenderModel({
					output: 'overlay',
					kind: 'mtg-commander',
					layout: layout([item]),
					featureMatch: {
						...commanderContext(),
						activeSeat: live.activeSeat ?? null,
						player2: {
							...seatState(31),
							eliminated: live.eliminated ?? false,
						},
					},
					itemAnimation: exiting
						? {
								indicator: [
									{ phase: 'exit', elapsed: 10 },
								],
							}
						: undefined,
					...CANVAS,
				}).graphics[0]!.items[0]!;
			}

			it.each([
				{
					name: 'an Active indicator on the active Seat',
					item: indicator('player2', 'active'),
					live: { activeSeat: 'player2' as const },
					shown: true,
				},
				{
					name: 'an Active indicator while another Seat has the turn',
					item: indicator('player2', 'active'),
					live: { activeSeat: 'player1' as const },
					shown: false,
				},
				{
					name: 'an Active indicator while no turn is tracked',
					item: indicator('player2', 'active'),
					live: {},
					shown: false,
				},
				{
					name: 'an Eliminated indicator on an Eliminated Seat',
					item: indicator('player2', 'eliminated'),
					live: { eliminated: true },
					shown: true,
				},
				{
					name: 'an Eliminated indicator on a Seat still in the game',
					item: indicator('player2', 'eliminated'),
					live: { activeSeat: 'player2' as const },
					shown: false,
				},
			])('paints $name: $shown', ({ item, live, shown }) => {
				expect(rendered(item, live).surface !== undefined).toBe(shown);
			});

			it('keeps painting while its exit plays, after the state has left', () => {
				expect(rendered(indicator('player2', 'active'), { activeSeat: 'player1' }, true).surface).toBeDefined();
			});
		});

		it('keeps a group holding a filled Seat\'s item, and paints nothing for the empty Seat\'s child', () => {
			const [plate] = items([
				group([
					life('player3', 'empty'),
					life('player4', 'filled'),
				]),
			], ['player3']);

			expect(paintsNothing(plate)).toBe(false);
			expect(plate!.children!.map(paintsNothing)).toEqual([true, false]);
		});
	});

	// Only a Commander Slot has empty Seats: a pair's item keeps its surface with nobody seated.
	it('keeps the surface of a Two-Player Slot\'s items while nobody is seated', () => {
		const [life] = resolveFeatureMatchOverlayCompositorRenderModel({
			output: 'overlay',
			kind: 'mtg-two-player',
			layout: layout([
				{
					...item('player-life', 'life'),
					surfaceStyle: {
						fill: { type: 'solid', color: '#112233' },
						fillOpacity: 1,
					},
				} as GraphicItemConfig,
			]),
			featureMatch: featureMatchGraphicsContext({
				event: null,
				featureMatch: null,
				matchState: null,
				sourceMatch: null,
				round: null,
				phase: null,
				displayTime: null,
			}),
			...CANVAS,
		}).graphics[0]!.items;

		expect(life!.surface).toBeDefined();
		expect(life!.text).toBe('');
	});

	it.each(['overlay', 'fill', 'key'] as const)('composes as a layer of its host in the %s Output', (output) => {
		// Mounted above the Frame, so a backdrop would cover the host-owned layer, and the
		// host both positions it and draws the one guide layer over it.
		const model = resolveFeatureMatchOverlayCompositorRenderModel({
			output,
			layout: layout([]),
			...CANVAS,
		});

		expect(model.canvasRole).toBe('layer');
		expect(model.canvasStyle.background).toBe('transparent');
		expect(model.canvasStyle.position).toBeUndefined();
	});

	it('draws no guide of any kind unless an editor preview asks for one', () => {
		// Preview guides never appear in live Screen Outputs or captures. A live output
		// asks for neither flag, so this is the model-level half of that property —
		// checked in every output, because nothing about the output selection changes
		// the answer.
		for (const output of ['overlay', 'fill', 'key'] as const) {
			const model = resolveFeatureMatchOverlayCompositorRenderModel({
				output,
				layout: layout([
					item('clock', 'clock'),
					item('game-wins', 'wins'),
				]),
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
			animation: {
				enter: {
					duration: 400,
					easing: 'linear' as const,
					delay: 0,
					fade: { opacity: 0 },
				},
			},
		} as GraphicItemConfig;
		const model = resolveFeatureMatchOverlayCompositorRenderModel({
			output: 'overlay',
			layout: layout([withEnter]),
			itemAnimation: {
				name: [
					{ phase: 'enter', elapsed: 200 },
				],
			},
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
			animation: {
				exit: {
					duration: 400,
					easing: 'linear' as const,
					delay: 0,
					fade: { opacity: 0 },
				},
			},
		} as GraphicItemConfig;
		const hidden = {
			clockDisplayTime: '0:00',
			player1: {
				lifeTotal: null,
				gameWins: 0,
				sideboard: [
					{ name: 'Rest in Peace', quantity: 2, imageUrl: null },
				],
				sideboardRevealed: false,
			},
			player2: {
				lifeTotal: null,
				gameWins: 0,
				sideboard: null,
				sideboardRevealed: false,
			},
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

		const leaving = at({
			'side-1': [
				{ phase: 'exit', elapsed: 200 },
			],
		});
		expect(leaving.text).toContain('Rest in Peace');
		expect(leaving.style.opacity).toBe(0.5);

		expect(at().text).toBeUndefined();
	});

	it('guides every shared Graphic Item and marks the selected one, when asked', () => {
		const model = resolveFeatureMatchOverlayCompositorRenderModel({
			output: 'overlay',
			layout: layout([
				item('clock', 'clock'),
				item('game-wins', 'wins'),
			]),
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
		event: {
			name: 'Regional',
			game: 'mtg' as const,
			displayRecordSeparator: '-',
			displayHideZeroDraws: true,
		},
		featureMatch: {
			bestOf: 3,
			tableNumber: 4,
			roundName: 'Round 5',
			formatName: 'Modern',
			player1Data: {
				name: 'Alice',
				pronouns: 'she/her',
				lgs: 'Card Shop',
				wins: 4,
				losses: 1,
				draws: 0,
			},
			player2Data: {
				name: 'Bo',
				pronouns: 'they/them',
				lgs: 'Game Den',
				wins: 3,
				losses: 2,
				draws: 1,
			},
		},
		matchState: {
			player1: { lifeTotal: 12, gameWins: 2 },
			player2: { lifeTotal: 20, gameWins: 0 },
		},
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
			featureMatch: {
				...HOST_STATE.featureMatch,
				player1Data: { name: 'Alice' },
			},
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
			featureMatch: {
				bestOf: 3,
				activeSession: {
					sourceSnapshot: { bestOf: 5 },
				},
			},
			matchState: {
				player1: { lifeTotal: 12, gameWins: 2, sideboardRevealed: true },
				player2: { lifeTotal: 20, gameWins: 0, sideboardRevealed: false },
			},
			displayTime: '4:31',
		} as unknown as Parameters<typeof featureMatchGraphicsContext>[0]);

		expect(context.bestOf).toBe(5);
		// No resolved deck data supplied: `null`, never a placeholder sideboard.
		expect(context.player1).toEqual({
			lifeTotal: 12,
			gameWins: 2,
			sideboard: null,
			sideboardRevealed: true,
		});
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
			player1: [
				{ name: 'Counterspell', quantity: 2, imageUrl: 'https://img.test/counterspell.jpg' },
			],
			// `null` art is a card that resolved without an image: the placeholder
			// rendering, not an absent sideboard.
			player2: [
				{ name: 'Duress', quantity: 3, imageUrl: null },
			],
		};
		const context = featureMatchGraphicsContext({
			featureMatch: null,
			matchState: {
				player1: { lifeTotal: 12, gameWins: 2, sideboardRevealed: true },
				player2: { lifeTotal: 20, gameWins: 0, sideboardRevealed: false },
			},
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
			matchState: {
				player1: { lifeTotal: 20, gameWins: 0 },
				player2: { lifeTotal: 20, gameWins: 0 },
			},
			displayTime: '0:00',
		} as unknown as Parameters<typeof featureMatchGraphicsContext>[0]);
		expect(legacy.player1.sideboardRevealed).toBe(false);
	});
});

describe('featureMatchGraphicsContext on a Commander Event', () => {
	const COMMANDER_EVENT = { name: 'Commander Night', game: 'mtg', variant: 'commander' };
	type Input = Parameters<typeof featureMatchGraphicsContext>[0];
	const seat = (lifeTotal: number) => ({ lifeTotal, gameWins: 0, sideboardRevealed: false });

	it('reads all four Seats\' life from the Session', () => {
		const context = featureMatchGraphicsContext({
			event: COMMANDER_EVENT,
			featureMatch: {
				activeSession: {
					sourceSnapshot: commanderSnapshot(),
				},
			},
			matchState: {
				player1: seat(40),
				player2: seat(31),
				player3: seat(22),
				player4: seat(13),
			},
			displayTime: null,
		} as unknown as Input);

		expect([
			context.player1,
			context.player2,
			context.player3,
			context.player4,
		].map(state => state?.lifeTotal))
			.toEqual([40, 31, 22, 13]);
		expect(context.bestOf).toBe(1);
	});

	it('reads whose turn it is, who is Eliminated, and each Seat\'s Commander Damage per opposing Commander in Seat order', () => {
		const context = featureMatchGraphicsContext({
			event: COMMANDER_EVENT,
			// Ana (Atraxa), Ben (Tymna), Cleo (Tymna and Kraum), Dara (Atraxa).
			featureMatch: {
				activeSession: {
					sourceSnapshot: commanderSnapshot(),
				},
			},
			matchState: {
				activePlayer: 'player3',
				player1: {
					...seat(40),
					commanderDamage: [
						{ seat: 'player3', commander: 2, damage: 7 },
						{ seat: 'player2', commander: 1, damage: 3 },
					],
				},
				player2: seat(31),
				player3: seat(22),
				player4: {
					...seat(13),
					eliminated: true,
				},
			},
			displayTime: null,
		} as unknown as Input);

		expect(context.activeSeat).toBe('player3');
		expect([context.player1.eliminated, context.player4?.eliminated]).toEqual([false, true]);
		// Seat 1 faces Ben's Tymna, Cleo's Tymna and Kraum, then Dara's Atraxa.
		expect(context.player1.commanderDamage).toEqual([
			{
				damage: 3,
				imageUrl: scryfallCardImageUrl(TYMNA.scryfallId),
			},
			{
				damage: 0,
				imageUrl: scryfallCardImageUrl(TYMNA.scryfallId),
			},
			{
				damage: 7,
				imageUrl: scryfallCardImageUrl(KRAUM.scryfallId),
			},
			{
				damage: 0,
				imageUrl: scryfallCardImageUrl(ATRAXA.scryfallId),
			},
		]);
	});

	it('reads a Two-Player Session\'s active player as its active Seat, and no Commander game', () => {
		const context = featureMatchGraphicsContext({
			event: { name: 'Open', game: 'mtg', variant: 'two-player' },
			featureMatch: null,
			matchState: {
				activePlayer: 'player2',
				player1: seat(20),
				player2: seat(20),
			},
			displayTime: null,
		} as unknown as Input);

		expect(context.activeSeat).toBe('player2');
		expect(context.player2.eliminated).toBeUndefined();
		expect(context.player2.commanderDamage).toBeUndefined();
	});

	// A Seat is in the game while it is filled: the Session's snapshot says, or the Slot before one opens.
	it.each([
		{
			name: 'a Seat the Session\'s snapshot leaves empty',
			featureMatch: {
				activeSession: {
					sourceSnapshot: commanderSnapshot({ player3: null }),
				},
			},
			emptySeats: ['player3'],
		},
		{
			name: 'the Seats the Slot leaves empty, before a Session opens',
			featureMatch: {
				player1Data: seatedPlayer('Ana'),
				player2Data: null,
				player4Data: seatedPlayer('Dara'),
				activeSession: null,
			},
			emptySeats: ['player2', 'player3'],
		},
		{
			name: 'every Seat while no Slot is bound',
			featureMatch: null,
			emptySeats: [
				'player1',
				'player2',
				'player3',
				'player4',
			],
		},
	])('names $name as empty', ({ featureMatch, emptySeats }) => {
		const context = featureMatchGraphicsContext({
			event: COMMANDER_EVENT,
			featureMatch,
			matchState: null,
			displayTime: null,
		} as unknown as Input);

		expect(context.emptySeats).toEqual(emptySeats);
	});

	// Only a Commander Slot's context holds a third Seat or names empty ones.
	it('gives a Two-Player Event\'s no third Seat and no empty Seats', () => {
		const context = featureMatchGraphicsContext({
			event: { name: 'Open', game: 'mtg', variant: 'two-player' },
			featureMatch: null,
			matchState: null,
			displayTime: null,
		} as unknown as Input);

		expect(context.player3).toBeUndefined();
		expect(context.emptySeats).toBeUndefined();
	});
});
