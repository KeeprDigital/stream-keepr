import type { ManaCurve } from '~~/shared/types/deckList';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { CURVE_MAX_BUCKET } from '~~/shared/utils/deckStats';

const THEME_KEY = Symbol('theme');

vi.mock('vue-echarts', () => ({
	THEME_KEY,
	default: {
		name: 'VChart',
		props: {
			option: { type: Object, required: true },
			autoresize: { type: Boolean, required: false },
		},
		template: '<div class="v-chart-stub" />',
	},
}));

function makeCurve(overrides: Record<number, number> = {}): ManaCurve {
	const curve = Array.from({ length: CURVE_MAX_BUCKET + 1 }).fill(0) as ManaCurve;
	for (const [index, value] of Object.entries(overrides))
		curve[Number(index)] = value;
	return curve;
}

async function mountComponent(curve: ManaCurve, height?: number) {
	const componentPath = '../../../../app/components/Deck/ManaCurveChart.vue';
	const { default: DeckManaCurveChart } = await import(componentPath);

	return mount(DeckManaCurveChart, {
		props: {
			curve,
			height,
		},
	});
}

describe('deckManaCurveChart', () => {
	it('maps visible buckets and counts into an echarts bar option', async () => {
		const wrapper = await mountComponent(makeCurve({ 0: 1, 1: 3, 2: 2, [CURVE_MAX_BUCKET]: 4 }), 180);

		const chart = wrapper.getComponent({ name: 'VChart' });
		const props = chart.props();
		const option = props.option as {
			animation: boolean;
			stateAnimation: { duration: number };
			xAxis: { type: string; data: string[] };
			yAxis: { type: string; min: number; interval: number; max: number };
			series: Array<{
				type: string;
				data: number[];
				barMaxWidth: number;
				silent: boolean;
				emphasis: { disabled: boolean };
				select: { disabled: boolean };
				itemStyle: { borderRadius: number[] };
			}>;
			tooltip: { show: boolean; triggerOn: string };
		};

		expect(props.autoresize).toBe(true);
		expect(option.animation).toBe(false);
		expect(option.stateAnimation.duration).toBe(0);
		expect(option.tooltip.show).toBe(false);
		expect(option.tooltip.triggerOn).toBe('none');
		expect(option.xAxis).toMatchObject({
			type: 'category',
			data: ['0', '1', '2', `${CURVE_MAX_BUCKET}+`],
		});
		expect(option.yAxis).toMatchObject({
			type: 'value',
			min: 0,
			interval: 1,
			max: 4,
		});
		expect(option.series).toEqual([
			{
				type: 'bar',
				silent: true,
				data: [1, 3, 2, 4],
				barMaxWidth: 32,
				emphasis: {
					disabled: true,
				},
				select: {
					disabled: true,
				},
				itemStyle: {
					borderRadius: [4, 4, 0, 0],
				},
			},
		]);
	});

	it('keeps a minimal y axis when the curve is empty', async () => {
		const wrapper = await mountComponent(makeCurve());

		const option = wrapper.getComponent({ name: 'VChart' }).props('option') as {
			xAxis: { data: string[] };
			yAxis: { interval: number; max: number };
			series: Array<{ data: number[] }>;
		};

		expect(option.xAxis.data).toEqual(['0']);
		expect(option.yAxis.interval).toBe(1);
		expect(option.yAxis.max).toBe(1);
		expect(option.series[0]?.data).toEqual([0]);
	});
});
