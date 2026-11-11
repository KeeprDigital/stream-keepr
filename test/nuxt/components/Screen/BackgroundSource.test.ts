import type { BackgroundLayer } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { assetImageLayer } from '~~/test/helpers/backgroundLayers';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { fakeScreenThemeNetwork, screenSettingsPage, seedThemedScreen } from '~~/test/nuxt/helpers/screenThemeOverrides';
import BackgroundSource from '~/components/Screen/BackgroundSource.vue';

// A Screen's background has two sources: its own Background Layer stack, else
// its Theme's. While it holds none the Theme's shows read-only, to be copied
// in; while it holds one, Reset to Theme empties it.

const { mockApiFetch } = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockApiFetch);

enableAutoUnmount(afterEach);

const EditorStub = defineComponent({
	props: {
		layers: { type: Array, required: true },
	},
	template: '<div data-testid="layers-editor" :data-layer-ids="layers.map(layer => layer.id).join(\',\')" />',
});

const WASH: BackgroundLayer = {
	id: 'wash',
	type: 'color',
	enabled: false,
	opacity: 0.6,
	color: '#0b1020',
};
const THEME_STACK: BackgroundLayer[] = [
	WASH,
	assetImageLayer('plate'),
];

let network: ReturnType<typeof fakeScreenThemeNetwork>;

beforeEach(() => {
	network = fakeScreenThemeNetwork(mockApiFetch, 'metagame');
});

async function mountSource(own: BackgroundLayer[], themeStack: BackgroundLayer[]) {
	network.themeTokens = { background: themeStack };
	const writes: BackgroundLayer[][] = [];
	const wrapper = mount(screenSettingsPage(seedThemedScreen('metagame'), () => h(BackgroundSource, {
		'layers': own,
		'eventId': 1,
		'onUpdate:layers': (layers: BackgroundLayer[]) => writes.push(layers),
	})), {
		global: {
			stubs: {
				...nuxtUiStubs,
				ScreenBackgroundLayersEditor: EditorStub,
			},
		},
	});
	await flushPromises();
	return { wrapper, writes };
}

describe('a Screen\'s background source', () => {
	it.each([
		[
			'the Theme\'s stack, read-only, while the Screen holds none',
			[],
			THEME_STACK,
			{
				source: 'theme',
				themeLayers: ['color', 'image'],
				editor: null,
				actions: ['Customise for this Screen'],
			},
		],
		[
			'the Screen\'s own stack, editable, while it holds one',
			[
				assetImageLayer('own'),
			],
			THEME_STACK,
			{
				source: 'screen',
				themeLayers: [],
				editor: 'own',
				actions: ['Reset to Theme'],
			},
		],
		// Nothing to copy: the Screen starts its own stack from the editor.
		[
			'an empty editor while neither holds a layer',
			[],
			[],
			{
				source: 'theme',
				themeLayers: [],
				editor: '',
				actions: [],
			},
		],
	])('shows %s', async (_case, own, themeStack, expected) => {
		const { wrapper } = await mountSource(own, themeStack);

		const editor = wrapper.find('[data-testid="layers-editor"]');
		expect({
			source: wrapper.get('[data-background-source]').attributes('data-background-source'),
			themeLayers: wrapper.findAll('[data-testid="theme-background-layer"]').map(row => row.attributes('data-layer-type')),
			editor: editor.exists()
				? editor.attributes('data-layer-ids')
				: null,
			actions: wrapper.findAll('button').map(button => button.text()),
		}).toEqual(expected);
	});

	it('names the Theme and each inherited layer\'s state', async () => {
		const { wrapper } = await mountSource([], THEME_STACK);

		expect(wrapper.text()).toContain('Brand');
		const [wash, plate] = wrapper.findAll('[data-testid="theme-background-layer"]');
		expect(wash!.attributes('data-layer-enabled')).toBe('false');
		expect(wash!.text()).toContain('60%');
		expect(plate!.attributes('data-layer-enabled')).toBe('true');
		expect(plate!.text()).toContain('100%');
	});

	it.each([
		[
			'Customise for this Screen writes a copy of the Theme\'s stack as the Screen\'s own',
			[],
			'Customise for this Screen',
			THEME_STACK,
		],
		[
			'Reset to Theme writes the empty stack',
			[
				assetImageLayer('own'),
			],
			'Reset to Theme',
			[],
		],
	])('%s', async (_case, own, action, written) => {
		const { wrapper, writes } = await mountSource(own, THEME_STACK);

		await wrapper.findAll('button').find(button => button.text() === action)!.trigger('click');

		expect(writes).toEqual([written]);
	});
});
