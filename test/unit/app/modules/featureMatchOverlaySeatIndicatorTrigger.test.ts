import type { GraphicAnimation, GraphicItemConfig, SeatIndicatorGraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { createFeatureMatchLayoutComposition } from '~~/shared/featureMatchLayoutComposition';
import { getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { applySeatIndicatorEdge } from '~/modules/feature-match-overlay/seatIndicatorTrigger';

// A Seat entering the state its Seat Indicators mark plays their enter, and leaving it their exit (ADR-0087).

const LINEAR = { duration: 400, easing: 'linear' as const, delay: 0 };
const ENTER_AND_EXIT: GraphicAnimation = {
	enter: {
		...LINEAR,
		fade: { opacity: 0 },
	},
	exit: {
		...LINEAR,
		fade: { opacity: 0 },
	},
};

function indicator(id: string, overrides: Partial<SeatIndicatorGraphicItemConfig> = {}): SeatIndicatorGraphicItemConfig {
	return {
		...getGraphicItemDefinition('seat-indicator').createDefault({
			id,
			label: id,
			canvasWidth: 1920,
			canvasHeight: 1080,
		}) as SeatIndicatorGraphicItemConfig,
		playerSide: 'player3',
		state: 'active',
		animation: ENTER_AND_EXIT,
		...overrides,
	};
}

function composition(items: GraphicItemConfig[]) {
	return {
		...createFeatureMatchLayoutComposition(),
		items,
	};
}

describe('a Seat Indicator edge', () => {
	it.each([
		{ inState: true, phase: 'enter' },
		{ inState: false, phase: 'exit' },
	] as const)('plays $phase on the Seat\'s indicators of that state when in-state turns $inState', ({ inState, phase }) => {
		const triggers = applySeatIndicatorEdge([], composition([
			indicator('turn'),
		]), 'player3', 'active', inState, 1000);

		expect(triggers).toEqual([
			{
				itemId: 'turn',
				phase,
				startedAt: 1000,
				endsAt: 1400,
			},
		]);
	});

	it.each([
		{
			name: 'another Seat\'s',
			item: indicator('other', { playerSide: 'player1' }),
		},
		{
			name: 'the other state\'s',
			item: indicator('out', { state: 'eliminated' }),
		},
		{
			name: 'a hidden',
			item: indicator('hidden', { visible: false }),
		},
		{
			name: 'one with no recipe for the phase',
			item: indicator('cut', { animation: undefined }),
		},
	])('starts nothing on $name indicator', ({ item }) => {
		expect(applySeatIndicatorEdge([], composition([item]), 'player3', 'active', true, 1000)).toEqual([]);
	});

	it('reaches an indicator inside a visible Graphic Group', () => {
		const group = {
			...getGraphicItemDefinition('group').createDefault({
				id: 'plate',
				label: 'plate',
				canvasWidth: 1920,
				canvasHeight: 1080,
			}),
			children: [
				indicator('turn'),
			],
		} as GraphicItemConfig;

		expect(applySeatIndicatorEdge([], composition([group]), 'player3', 'active', true, 0).map(trigger => trigger.itemId)).toEqual(['turn']);
	});

	it('supersedes what the indicator was playing', () => {
		const entering = applySeatIndicatorEdge([], composition([
			indicator('turn'),
		]), 'player3', 'active', true, 0);
		const leaving = applySeatIndicatorEdge(entering, composition([
			indicator('turn'),
		]), 'player3', 'active', false, 100);

		expect(leaving).toEqual([
			{
				itemId: 'turn',
				phase: 'exit',
				startedAt: 100,
				endsAt: 500,
			},
		]);
	});
});
