import type { PlayerSide } from '~~/shared/types/enums';
import type {
	BroadcastGraphicConfig,
	DeckListGraphicItemConfig,
	GraphicAnimation,
	GraphicGroupChildConfig,
	GraphicGroupItemConfig,
} from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { createFeatureMatchLayoutComposition } from '~~/shared/featureMatchLayoutComposition';
import { getGraphicItemDefinition, squareShapeGeometry } from '~~/shared/modules/graphics';
import {
	applySideboardRevealEdge,
	settleSideboardRevealTriggers,
	sideboardRevealItemAnimation,
} from '~/modules/feature-match-overlay/sideboardRevealTrigger';

const LINEAR = { duration: 400, easing: 'linear' as const, delay: 0 };
const ENTER_AND_EXIT: GraphicAnimation = {
	enter: { ...LINEAR, fade: { opacity: 0 } },
	exit: { ...LINEAR, fade: { opacity: 0 } },
};

function deckList(
	id: string,
	overrides: Partial<DeckListGraphicItemConfig> = {},
): DeckListGraphicItemConfig {
	const item = getGraphicItemDefinition('deck-list').createDefault({
		id,
		label: id,
		canvasWidth: 1920,
		canvasHeight: 1080,
	}) as DeckListGraphicItemConfig;
	return { ...item, animation: ENTER_AND_EXIT, ...overrides };
}

function group(id: string, children: GraphicGroupChildConfig[], overrides: Partial<GraphicGroupItemConfig> = {}): GraphicGroupItemConfig {
	return {
		type: 'group',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 600,
		height: 400,
		arrangement: 'row',
		padding: 0,
		gap: 16,
		align: 'stretch',
		justify: 'start',
		clip: false,
		geometry: squareShapeGeometry(),
		children,
		...overrides,
	};
}

function composition(items: BroadcastGraphicConfig['items']): BroadcastGraphicConfig {
	return { ...createFeatureMatchLayoutComposition(), items };
}

function edge(
	items: BroadcastGraphicConfig['items'],
	side: PlayerSide,
	revealed: boolean,
	now = 1000,
) {
	return applySideboardRevealEdge([], composition(items), side, revealed, now);
}

describe('applySideboardRevealEdge', () => {
	it('starts an enter for each of the side"s authored-visible Deck List Items with an enter recipe', () => {
		// The trigger is per item: two Deck Lists bound to the revealed side both
		// play, wherever they live — the top level or inside a Graphic Group.
		const triggers = edge([
			deckList('top'),
			group('cluster', [deckList('grouped')]),
			deckList('other-side', { playerSide: 'player2' }),
		], 'player1', true);

		expect(triggers.map(trigger => [trigger.itemId, trigger.phase])).toEqual([
			['top', 'enter'],
			['grouped', 'enter'],
		]);
		// delay + duration: the instant the host drops the settled trigger.
		expect(triggers[0]).toMatchObject({ startedAt: 1000, endsAt: 1400 });
	});

	it('skips an item its author hid, and one inside a hidden Graphic Group', () => {
		// Authored `visible: false` short-circuits everything — no animation, no
		// render (ADR 0015) — and a hidden group's children never render either.
		const triggers = edge([
			deckList('hidden', { visible: false }),
			group('hidden-cluster', [deckList('inside')], { visible: false }),
		], 'player1', true);

		expect(triggers).toEqual([]);
	});

	it('starts nothing for an item with no recipe for the edge"s phase', () => {
		// No authored motion means the flag alone decides, immediately: an absent
		// recipe is a Cut, not a default animation.
		const triggers = edge([deckList('plain', { animation: undefined })], 'player1', true);

		expect(triggers).toEqual([]);
	});

	it('supersedes whatever the side"s items were playing, and only theirs', () => {
		// A hide landing mid-enter must not leave the finished enter composing over
		// the exit — and an edge for one player must not touch the other's motion.
		const items = [deckList('mine'), deckList('theirs', { playerSide: 'player2' })];
		const running = [
			...edge(items, 'player1', true, 1000),
			...applySideboardRevealEdge([], composition(items), 'player2', true, 1100),
		];

		const after = applySideboardRevealEdge(running, composition(items), 'player1', false, 1200);

		expect(after.map(trigger => [trigger.itemId, trigger.phase, trigger.startedAt])).toEqual([
			['theirs', 'enter', 1100],
			['mine', 'exit', 1200],
		]);
	});

	it('supersedes a running enter even when the hide has no exit recipe to play', () => {
		// Hiding an item whose author gave it only an enter is an immediate Cut,
		// and the interrupted enter must not keep running over it.
		const items = [deckList('mine', { animation: { enter: { ...LINEAR, fade: { opacity: 0 } } } })];
		const running = edge(items, 'player1', true, 1000);

		expect(applySideboardRevealEdge(running, composition(items), 'player1', false, 1200)).toEqual([]);
	});
});

describe('settleSideboardRevealTriggers', () => {
	it('drops a trigger the instant its recipe"s own end has passed, and no sooner', () => {
		// A settled exit projects its hidden end-state forever; dropping it is what
		// hands the item back to the flag's renders-nothing state.
		const triggers = edge([deckList('mine')], 'player1', false, 1000);

		expect(settleSideboardRevealTriggers(triggers, 1399)).toEqual(triggers);
		expect(settleSideboardRevealTriggers(triggers, 1400)).toEqual([]);
	});
});

describe('sideboardRevealItemAnimation', () => {
	it('projects each running trigger as the per-item map the host adapter takes', () => {
		const items = [deckList('mine'), group('cluster', [deckList('grouped')])];
		const triggers = edge(items, 'player1', true, 1000);

		expect(sideboardRevealItemAnimation(triggers, 1250)).toEqual({
			mine: [{ phase: 'enter', elapsed: 250 }],
			grouped: [{ phase: 'enter', elapsed: 250 }],
		});
	});

	it('projects nothing at all while no trigger runs', () => {
		// `undefined` rather than an empty map, so the settled overlay passes the
		// compositor exactly the input it passed before the mechanism existed.
		expect(sideboardRevealItemAnimation([], 1250)).toBeUndefined();
	});
});
