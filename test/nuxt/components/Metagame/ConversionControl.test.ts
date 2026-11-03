import type { ConversionTarget } from '~~/shared/conversionTarget';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ConversionControl from '~/components/Metagame/ConversionControl.vue';

function mountControl(target: ConversionTarget) {
	return mount(ConversionControl, {
		props: target,
		global: { stubs: nuxtUiStubs },
	});
}

// The control writes the Event's Conversion Target whole, within its metric's bounds (ADR-0061).
describe('metagame ConversionControl', () => {
	it.each([
		{
			from: { conversionMetric: 'minPoints', conversionThreshold: 0 },
			pick: 'topN:16',
			wrote: { conversionMetric: 'topN', conversionThreshold: 16 },
		},
		// A Top N target is at least 1, so a minimum of 0 points becomes Top 1.
		{
			from: { conversionMetric: 'minPoints', conversionThreshold: 0 },
			pick: 'topN',
			wrote: { conversionMetric: 'topN', conversionThreshold: 1 },
		},
		{
			from: { conversionMetric: 'minPoints', conversionThreshold: 12 },
			pick: 'topN',
			wrote: { conversionMetric: 'topN', conversionThreshold: 12 },
		},
		{
			from: { conversionMetric: 'topN', conversionThreshold: 8 },
			pick: 'minPoints',
			wrote: { conversionMetric: 'minPoints', conversionThreshold: 8 },
		},
	] as const)('picking $pick from $from writes $wrote', async ({ from, pick, wrote }) => {
		const wrapper = mountControl(from);

		await wrapper.get('select[aria-label="Conversion target"]').setValue(pick);

		expect(wrapper.emitted('update')).toEqual([
			[wrote],
		]);
	});

	it.each([
		{
			target: { conversionMetric: 'minPoints', conversionThreshold: 9 },
			label: 'Conversion minimum points',
			min: '0',
			typed: 0,
		},
		{
			target: { conversionMetric: 'topN', conversionThreshold: 12 },
			label: 'Conversion top N placement',
			min: '1',
			typed: 24,
		},
	] as const)('bounds and writes a typed $target.conversionMetric threshold', async ({ target, label, min, typed }) => {
		const wrapper = mountControl(target);
		const input = wrapper.get(`input[aria-label="${label}"]`);

		expect(input.attributes('min')).toBe(min);
		await input.setValue(String(typed));

		expect(wrapper.emitted('update')).toEqual([
			[
				{ conversionMetric: target.conversionMetric, conversionThreshold: typed },
			],
		]);
	});

	it('writes nothing for an emptied threshold', async () => {
		const wrapper = mountControl({ conversionMetric: 'minPoints', conversionThreshold: 9 });

		await wrapper.get('input[aria-label="Conversion minimum points"]').setValue('');

		expect(wrapper.emitted('update')).toBeUndefined();
	});
});
