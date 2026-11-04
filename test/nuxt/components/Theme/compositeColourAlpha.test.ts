import type { Component } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import BackgroundLayersTokenInput from '~/components/Theme/BackgroundLayersTokenInput.vue';
import FillTokenInput from '~/components/Theme/FillTokenInput.vue';
import SurfaceStyleTokenInput from '~/components/Theme/SurfaceStyleTokenInput.vue';

// A composite token's own colour edits alpha only where no opacity control
// sits beside it (#955 decision 4).

enableAutoUnmount(afterEach);

const GRADIENT = {
	type: 'linear-gradient',
	angle: 90,
	stops: [
		{ color: '#112233', position: 0, opacity: 1 },
		{ color: '#445566', position: 1, opacity: 1 },
	],
} as const;

const SURFACE = {
	fill: { type: 'solid', color: '#112233' },
	fillOpacity: 1,
	outline: { color: '#445566', width: 2 },
	glow: { color: '#778899', size: 8, opacity: 0.5 },
} as const;

describe('a composite token\'s own colours', () => {
	it.each<[string, Component, Record<string, unknown>, string, boolean]>([
		[
			'a fill token\'s solid colour edits alpha',
			FillTokenInput,
			{
				modelValue: { type: 'solid', color: '#112233' },
			},
			'Brand fill colour',
			true,
		],
		[
			'a fill token\'s gradient stop has none, beside its opacity',
			FillTokenInput,
			{ modelValue: GRADIENT },
			'Brand stop 1 colour',
			false,
		],
		[
			'a surface\'s fill has none, beside its Fill opacity',
			SurfaceStyleTokenInput,
			{ modelValue: SURFACE },
			'Brand fill colour',
			false,
		],
		[
			'a surface\'s outline edits alpha',
			SurfaceStyleTokenInput,
			{ modelValue: SURFACE },
			'Brand outline colour',
			true,
		],
		[
			'a surface\'s glow has none, beside its opacity',
			SurfaceStyleTokenInput,
			{ modelValue: SURFACE },
			'Brand glow colour',
			false,
		],
		[
			'a background colour layer has none, beside its opacity',
			BackgroundLayersTokenInput,
			{
				modelValue: [
					{
						id: 'wash',
						type: 'color',
						enabled: true,
						opacity: 1,
						color: '#112233',
					},
				],
			},
			'Brand layer colour',
			false,
		],
	])('%s', async (_case, input, props, picker, alpha) => {
		const wrapper = mount(input, {
			props: { label: 'Brand', ...props },
			global: { stubs: nuxtUiStubs },
		});
		await flushPromises();

		await wrapper.get(`[aria-label="${picker}"]`).trigger('click');

		expect(wrapper.find('[data-color-part="hue"]').exists()).toBe(true);
		expect(wrapper.find('[data-color-part="alpha"]').exists()).toBe(alpha);
	});
});
