import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { TOP_CUT_BRACKET_SIZES } from '~~/shared/screenModeConfigs/topCut';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import BracketSizeField from '~/components/Screen/Modes/TopCut/BracketSizeField.vue';

// A Top Cut Bracket's size: sized from its first Round until one is picked, a set size only enlarging it (#906).

enableAutoUnmount(afterEach);

function mountField(modelValue: number | undefined) {
	return mount(BracketSizeField, {
		props: {
			entry: {
				path: ['bracketSizeOverride'],
				field: screenModeConfigContract('top-cut').fields.bracketSizeOverride,
				context: { config: { bracketSource: 'phase' }, event: null },
			},
			modelValue,
		},
		global: { stubs: nuxtUiStubs },
	});
}

describe('a Top Cut Bracket\'s size', () => {
	it('offers each size after sizing from the first Round, which it holds until one is picked, and says a smaller one is ignored', () => {
		const wrapper = mountField(undefined);
		const select = wrapper.get<HTMLSelectElement>('select');

		expect(select.findAll('option:not([hidden])').map(option => option.text())).toEqual([
			'From the first Round',
			...TOP_CUT_BRACKET_SIZES.map(size => `Top ${size}`),
		]);
		expect(select.element.selectedOptions[0]!.text).toBe('From the first Round');
		expect(wrapper.text()).toMatch(/smaller .* ignored/);
	});

	it.each([
		{ picked: '32', size: 32 },
		{ picked: 'null', size: null },
	])('emits the size picked, $size', async ({ picked, size }) => {
		const wrapper = mountField(16);

		await wrapper.get('select').setValue(picked);

		expect(wrapper.emitted('update:modelValue')).toEqual([
			[size],
		]);
	});
});
