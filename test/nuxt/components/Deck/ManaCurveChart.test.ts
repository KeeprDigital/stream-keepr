import type { ManaCurve } from '~~/shared/types/deckList';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { CURVE_MAX_BUCKET } from '~~/shared/utils/deckStats';
import DeckManaCurveChart from '~/components/Deck/ManaCurveChart.vue';

vi.mock('vue-echarts', () => ({
	THEME_KEY: Symbol('theme'),
	default: {
		name: 'VChart',
		props: {
			option: { type: Object, required: true },
			autoresize: { type: Boolean, required: false },
		},
		template: '<div />',
	},
}));

interface ChartOption {
	xAxis: { data: string[] };
	yAxis: { interval: number; max: number };
	series: Array<{ data: number[] }>;
}

function makeCurve(overrides: Record<number, number> = {}): ManaCurve {
	const curve = Array.from({ length: CURVE_MAX_BUCKET + 1 }).fill(0) as ManaCurve;
	for (const [index, value] of Object.entries(overrides))
		curve[Number(index)] = value;
	return curve;
}

function chartOption(curve: ManaCurve): ChartOption {
	const wrapper = mount(DeckManaCurveChart, {
		props: { curve },
	});
	return wrapper.getComponent({ name: 'VChart' }).props('option') as ChartOption;
}

describe('deckManaCurveChart', () => {
	it('charts each bucket up to the highest one used, the last labelled as a floor', () => {
		const option = chartOption(makeCurve({
			0: 1,
			1: 3,
			2: 2,
			[CURVE_MAX_BUCKET]: 4,
		}));

		expect(option.xAxis.data).toEqual(['0', '1', '2', `${CURVE_MAX_BUCKET}+`]);
		expect(option.series[0]?.data).toEqual([1, 3, 2, 4]);
		expect(option.yAxis.max).toBe(4);
	});

	it('keeps a minimal y axis when the curve is empty', () => {
		const option = chartOption(makeCurve());

		expect(option.xAxis.data).toEqual(['0']);
		expect(option.yAxis).toMatchObject({ interval: 1, max: 1 });
		expect(option.series[0]?.data).toEqual([0]);
	});
});
