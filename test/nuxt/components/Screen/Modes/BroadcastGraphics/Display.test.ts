import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { GRAPHICS_PREVIEW_STATE_MESSAGE } from '~/modules/graphics/previewMessages';

enableAutoUnmount(afterEach);

const mockOutputMode = ref<ScreenOutput>('overlay');
const mockOutputModeProvided = ref(true);
const mockIsPreview = ref(false);
const mockPreviewGuides = ref(false);
const mockPreviewSafeAreas = ref(false);
const mockScreen = ref<Screen | null>(null);

mockNuxtImport('useScreenContext', () => () => ({
	screen: mockScreen,
	eventId: computed(() => 1),
	interactive: ref(false),
	overlayContainer: ref(null),
	outputMode: mockOutputModeProvided.value ? mockOutputMode : undefined,
	isPreview: mockIsPreview,
	previewGuides: mockPreviewGuides,
	previewSafeAreas: mockPreviewSafeAreas,
}));

mockNuxtImport('useScreenModeConfig', () => () => computed(() => ({
	graphics: [],
	...mockScreen.value?.modeConfigs?.['broadcast-graphics'],
})));

/** The authoritative playout snapshot a live Screen Output would have loaded. */
const mockOnAirGraphicIds = ref<string[]>([]);
const mockLoadSession = ref<(eventId: number, screenId: number) => void>(() => {});

mockNuxtImport('useBroadcastGraphicsSessionStore', () => () => ({
	onAirGraphicIds: (_screenId: number, graphics: readonly { id: string }[]) =>
		graphics.filter(graphic => mockOnAirGraphicIds.value.includes(graphic.id)).map(graphic => graphic.id),
	loadSession: (eventId: number, screenId: number) => mockLoadSession.value(eventId, screenId),
}));

const lowerThird: BroadcastGraphicConfig = {
	id: 'lower-third',
	name: 'Lower Third',
	items: [{
		type: 'shape',
		id: 'bar',
		label: 'Shape 1',
		visible: true,
		anchor: 'top-left',
		x: 100,
		y: 800,
		width: 900,
		height: 120,
		geometry: { cornerRadius: 0 },
		surfaceStyle: { fill: '#0077a3', fillOpacity: 1 },
	}],
};

function screenWithStack(graphics: BroadcastGraphicConfig[] = []): Screen {
	return {
		id: 1,
		slug: 'main',
		screenConfig: { width: 1920, height: 1080 },
		modeConfigs: graphics.length ? { 'broadcast-graphics': { graphics } } : {},
	} as Screen;
}

async function mountComponent() {
	const componentPath = '../../../../../../../app/components/Screen/Modes/BroadcastGraphics/Display.vue';
	const { default: Display } = await import(componentPath);

	return mount(Display);
}

function pushPreviewState(graphics: BroadcastGraphicConfig[] = [lowerThird]) {
	window.dispatchEvent(new MessageEvent('message', {
		origin: window.location.origin,
		source: window,
		data: {
			type: GRAPHICS_PREVIEW_STATE_MESSAGE,
			state: {
				graphics,
				selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
			},
		},
	}));
	return nextTick();
}

describe('broadcastGraphicsDisplay', () => {
	beforeEach(() => {
		mockOutputMode.value = 'overlay';
		mockOutputModeProvided.value = true;
		mockIsPreview.value = false;
		mockPreviewGuides.value = false;
		mockPreviewSafeAreas.value = false;
		mockScreen.value = screenWithStack();
		mockOnAirGraphicIds.value = [];
		mockLoadSession.value = () => {};
	});

	it('renders an empty Broadcast Graphics Screen transparent in the Overlay Output', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.classes()).toContain('broadcast-graphics--overlay');
		expect(wrapper.attributes('style')).toContain('background: transparent');
	});

	it('renders an empty Broadcast Graphics Screen black in the Fill Output', async () => {
		mockOutputMode.value = 'fill';

		const wrapper = await mountComponent();

		expect(wrapper.classes()).toContain('broadcast-graphics--fill');
		expect(wrapper.attributes('style')).toContain('background: #000');
	});

	it('renders an empty Broadcast Graphics Screen black in the Key Output', async () => {
		mockOutputMode.value = 'key';

		const wrapper = await mountComponent();

		expect(wrapper.classes()).toContain('broadcast-graphics--key');
		expect(wrapper.attributes('style')).toContain('background: #000');
	});

	it('falls back to the Overlay Output when the Screen context supplies no output selection', async () => {
		mockOutputModeProvided.value = false;

		const wrapper = await mountComponent();

		expect(wrapper.classes()).toContain('broadcast-graphics--overlay');
		expect(wrapper.attributes('style')).toContain('background: transparent');
	});

	it('leaves an authored but off-air Broadcast Graphic off every Screen Output', async () => {
		mockScreen.value = screenWithStack([lowerThird]);

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-broadcast-graphic="lower-third"]').exists()).toBe(false);
	});

	it('composes a Broadcast Graphic that playout has taken on air', async () => {
		mockScreen.value = screenWithStack([lowerThird]);
		mockOnAirGraphicIds.value = ['lower-third'];

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-broadcast-graphic="lower-third"]').exists()).toBe(true);
		expect(wrapper.get('[data-graphic-item-kind="shape"]').attributes('style')).toContain('left: 100px');
	});

	it('composes concurrent on-air Broadcast Graphics in authored stack order, not take order', async () => {
		const bug: BroadcastGraphicConfig = { ...lowerThird, id: 'bug', name: 'Bug' };
		mockScreen.value = screenWithStack([bug, lowerThird]);
		mockOnAirGraphicIds.value = ['lower-third', 'bug'];

		const wrapper = await mountComponent();

		const composed = wrapper.findAll('[data-broadcast-graphic]')
			.map(node => node.attributes('data-broadcast-graphic'));

		expect(composed).toEqual(['bug', 'lower-third']);
	});

	it('loads the authoritative playout snapshot for a live Screen Output', async () => {
		const loads: Array<[number, number]> = [];
		mockLoadSession.value = (eventId, screenId) => {
			loads.push([eventId, screenId]);
		};
		mockScreen.value = screenWithStack([lowerThird]);

		await mountComponent();

		expect(loads).toEqual([[1, 1]]);
	});

	it('never loads a playout snapshot for an embedded editor preview', async () => {
		const loads: Array<[number, number]> = [];
		mockLoadSession.value = (eventId, screenId) => {
			loads.push([eventId, screenId]);
		};
		mockIsPreview.value = true;
		mockScreen.value = screenWithStack([lowerThird]);

		await mountComponent();

		expect(loads).toEqual([]);
	});

	it('never draws advisory guides on a live Screen Output', async () => {
		mockScreen.value = screenWithStack([lowerThird]);

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-safe-area-guide]').exists()).toBe(false);
		expect(wrapper.find('.item-guide').exists()).toBe(false);
	});

	it('composes the Broadcast Graphic under authoring inside an editor preview', async () => {
		mockIsPreview.value = true;

		const wrapper = await mountComponent();
		await pushPreviewState();

		expect(wrapper.find('[data-broadcast-graphic="lower-third"]').exists()).toBe(true);
		expect(wrapper.get('[data-graphic-item-kind="shape"]').attributes('style')).toContain('left: 100px');
	});

	it('ignores a working composition pushed at a live Screen Output', async () => {
		const wrapper = await mountComponent();
		await pushPreviewState();

		expect(wrapper.find('[data-broadcast-graphic="lower-third"]').exists()).toBe(false);
	});

	it('composes every authored Broadcast Graphic in an editor preview, in stack order', async () => {
		mockIsPreview.value = true;
		const behind: BroadcastGraphicConfig = { ...lowerThird, id: 'bug', name: 'Bug' };

		const wrapper = await mountComponent();
		await pushPreviewState([behind, lowerThird]);

		const composed = wrapper.findAll('[data-broadcast-graphic]')
			.map(node => node.attributes('data-broadcast-graphic'));

		expect(composed).toEqual(['bug', 'lower-third']);
	});

	it('reorders the composed preview when the authored stack order changes', async () => {
		mockIsPreview.value = true;
		const behind: BroadcastGraphicConfig = { ...lowerThird, id: 'bug', name: 'Bug' };

		const wrapper = await mountComponent();
		await pushPreviewState([behind, lowerThird]);
		await pushPreviewState([lowerThird, behind]);

		const composed = wrapper.findAll('[data-broadcast-graphic]')
			.map(node => node.attributes('data-broadcast-graphic'));

		expect(composed).toEqual(['lower-third', 'bug']);
	});

	it('marks the Broadcast Graphic under authoring among its neighbours', async () => {
		mockIsPreview.value = true;
		mockPreviewGuides.value = true;
		const behind: BroadcastGraphicConfig = { ...lowerThird, id: 'bug', name: 'Bug' };

		const wrapper = await mountComponent();
		await pushPreviewState([behind, lowerThird]);

		const marks = wrapper.findAll('.item-guide')
			.map(node => node.attributes('data-in-selected-graphic'));

		expect(marks).toEqual(['false', 'true']);
	});

	it('draws advisory action-safe and title-safe guides only when the preview asks for them', async () => {
		mockIsPreview.value = true;
		mockPreviewSafeAreas.value = true;

		const wrapper = await mountComponent();
		await pushPreviewState();

		expect(wrapper.get('[data-safe-area-guide="action-safe"]').attributes('style')).toContain('left: 96px');
		expect(wrapper.get('[data-safe-area-guide="title-safe"]').attributes('style')).toContain('left: 192px');
	});

	it('marks the selected Graphic Item when the preview asks for item guides', async () => {
		mockIsPreview.value = true;
		mockPreviewGuides.value = true;

		const wrapper = await mountComponent();
		await pushPreviewState();

		expect(wrapper.get('.item-guide').classes()).toContain('is-selected');
	});
});
