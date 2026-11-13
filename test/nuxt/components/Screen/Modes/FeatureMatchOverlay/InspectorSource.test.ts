import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { FeatureMatchOverlayAnchorValue, FeatureMatchOverlayModeConfig, FeatureMatchSourceItemConfig } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { USelectStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { ScreenSettingsSectionStub } from '~~/test/nuxt/helpers/screenSettingsSection';
import { fakeScreenThemeNetwork, overrideWrites, screenSettingsPage, seedThemedScreen } from '~~/test/nuxt/helpers/screenThemeOverrides';
import InspectorSource from '~/components/Screen/Modes/FeatureMatchOverlay/InspectorSource.vue';
import SurfaceStyleTokenInput from '~/components/Theme/SurfaceStyleTokenInput.vue';
import { THEME_TOKEN_DRAFT_COMMIT_MS } from '~/modules/theme-editor/draft';
import { useEventStore } from '~/stores/event';

/**
 * A Source Item's Bounds section, with the real geometry fields and editor: what
 * each align action and size entry leaves in the layout. Its Appearance section
 * ends with the Look of every Source Item, `source-surface` (#982).
 */

const { mockApiFetch } = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockApiFetch);

enableAutoUnmount(afterEach);

/** A surface as a Screen Theme Override holds it: every colour a literal. */
const SURFACE = {
	fill: { type: 'solid', color: '#101010' },
	fillOpacity: 1,
	outline: { color: '#ff0000', width: 4 },
} as const;

beforeEach(() => {
	fakeScreenThemeNetwork(mockApiFetch, 'feature-match-overlay');
});

afterEach(() => {
	vi.useRealTimers();
});

const PassThroughStub = defineComponent({
	template: '<div><slot /></div>',
});

const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: {
		modelValue: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" />',
});

const UButtonStub = defineComponent({
	emits: ['click'],
	template: '<button type="button" @click="$emit(\'click\', $event)"><slot /></button>',
});

async function mountBounds(anchor: FeatureMatchOverlayAnchorValue, themeOverrides: StoredThemeTokens = {}, event: { game: string; variant: string | null } = { game: 'mtg', variant: 'two-player' }) {
	const config: FeatureMatchOverlayModeConfig = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	// An odd-sized 401×201 item at (100, 50) on a 1920×1080 canvas, so a
	// centre anchor sits on a half pixel.
	const item: FeatureMatchSourceItemConfig = {
		...config.layout.sources[0]!,
		x: 100,
		y: 50,
		width: 401,
		height: 201,
		anchor,
	};
	config.layout.sources = [item];
	const updateConfig = vi.fn();
	const screen = seedThemedScreen('feature-match-overlay', themeOverrides);
	const eventStore = useEventStore();
	eventStore.event = { ...eventStore.event, ...event } as never;

	const wrapper = mount(screenSettingsPage(screen, () => h(InspectorSource, {
		config,
		updateConfig,
		screen: screen(),
		eventId: 1,
		screenWidth: 1920,
		screenHeight: 1080,
		item,
	})), {
		global: {
			stubs: {
				ScreenSettingsSection: ScreenSettingsSectionStub,
				FeatureMatchOverlaySourceFramingStyleFields: true,
				FeatureMatchOverlayOrderSection: true,
				ScreenSettingsToggle: true,
				UFormField: PassThroughStub,
				UFieldGroup: PassThroughStub,
				UINinePointPicker: true,
				UInput: true,
				UInputNumber: UInputNumberStub,
				USelect: USelectStub,
				UButton: UButtonStub,
				UBadge: true,
			},
		},
	});
	await flushPromises();

	function storedRect() {
		const layout = updateConfig.mock.calls.at(-1)?.[0].layout as FeatureMatchOverlayModeConfig['layout'];
		const { x, y, width, height } = layout.sources[0]!;
		return { x, y, width, height };
	}

	async function align(label: string) {
		await wrapper.get(`button[aria-label="${label}"]`).trigger('click');
		return storedRect();
	}

	async function enter(ariaLabel: string, value: number) {
		wrapper.findAllComponents({ name: 'UInputNumber' })
			.find(input => input.attributes('aria-label') === ariaLabel)!
			.vm
			.$emit('update:modelValue', value);
		await nextTick();
		return storedRect();
	}

	async function link() {
		await wrapper.get('button[aria-label="Link width and height"]').trigger('click');
	}

	return { wrapper, align, enter, link };
}

// A Source Role names the main source or one Seat's: a pair's two Players, or a Commander Slot's four Seats (ADR-0087).
describe('feature Match Overlay Source Item: Source Role', () => {
	it.each([
		{ kind: 'a Two-Player', event: { game: 'mtg', variant: 'two-player' }, labels: ['Main', 'Player 1', 'Player 2'] },
		{ kind: 'a Commander', event: { game: 'mtg', variant: 'commander' }, labels: ['Main', 'Seat 1', 'Seat 2', 'Seat 3', 'Seat 4'] },
	])('offers $kind Event $labels', async ({ event, labels }) => {
		const { wrapper } = await mountBounds('top-left', {}, event);

		const select = wrapper.findAllComponents(USelectStub).find(candidate => candidate.attributes('aria-label') === 'Source role')!;
		expect((select.props('items') as Array<{ label: string }>).map(item => item.label)).toEqual(labels);
	});
});

describe('feature Match Overlay Source Item bounds: align actions', () => {
	const actions = [
		[
			'Hard left',
			{ x: 0, y: 50 },
		],
		[
			'Center horizontally',
			{ x: 759.5, y: 50 },
		],
		[
			'Hard right',
			{ x: 1519, y: 50 },
		],
		[
			'Hard top',
			{ x: 100, y: 0 },
		],
		[
			'Center vertically',
			{ x: 100, y: 439.5 },
		],
		[
			'Hard bottom',
			{ x: 100, y: 879 },
		],
	] as const;
	// A corner, the centre and the opposite corner: every anchor's offset is one of these three per axis.
	const anchors = ['top-left', 'center', 'bottom-right'] as const;
	const cases = anchors.flatMap(anchor => actions.map(([label, position]) => [anchor, label, position] as const));

	it.each(cases)('%s anchor: %s moves the item\'s edge, not its anchor', async (anchor, label, position) => {
		const { align } = await mountBounds(anchor);

		expect(await align(label)).toEqual({ ...position, width: 401, height: 201 });
	});
});

describe('feature Match Overlay Source Item bounds: size entry', () => {
	it('stores whole pixels and never shrinks a Source Item below one pixel', async () => {
		const { enter } = await mountBounds('top-left');

		expect(await enter('Item width', 0)).toEqual({ x: 100, y: 50, width: 1, height: 201 });
		expect(await enter('Item height', 99.6)).toEqual({
			x: 100,
			y: 50,
			width: 401,
			height: 100,
		});
	});
});

describe('feature Match Overlay Source Item bounds: linked width and height', () => {
	it('keeps the Source Item\'s aspect ratio from its anchor', async () => {
		const { enter, link } = await mountBounds('bottom-right');
		await link();

		// 401×201 doubled is 802×402, with the bottom-right corner held at (501, 251).
		expect(await enter('Item width', 802)).toEqual({
			x: -301,
			y: -151,
			width: 802,
			height: 402,
		});
	});
});

describe('feature Match Overlay Source Item appearance: the Source Item surface', () => {
	it('shows the `source-surface` row once, in Appearance', async () => {
		const { wrapper } = await mountBounds('top-left');

		expect(wrapper.findAll('[data-token]').map(row => row.attributes('data-token'))).toEqual(['feature-match-overlay.source-surface']);
		expect(wrapper.get('[data-section="Appearance"]').find('[data-token="feature-match-overlay.source-surface"]').exists()).toBe(true);
	});

	it.each([
		[
			'writes',
			{},
			{ 'feature-match-overlay.source-surface': SURFACE },
		],
		[
			'clears',
			{ 'feature-match-overlay.source-surface': SURFACE },
			{ 'feature-match-overlay.source-surface': null },
		],
	] as const)('%s its Screen Theme Override', async (action, stored, written) => {
		const { wrapper } = await mountBounds('top-left', stored);
		// A surface commits once its edits pause.
		vi.useFakeTimers({
			toFake: ['setTimeout', 'clearTimeout'],
		});
		const row = wrapper.get('[data-token="feature-match-overlay.source-surface"]');

		if (action === 'clears')
			await row.findAll('button').find(button => button.text() === 'Clear')!.trigger('click');
		else
			wrapper.getComponent(SurfaceStyleTokenInput).vm.$emit('commit', SURFACE);
		await vi.advanceTimersByTimeAsync(THEME_TOKEN_DRAFT_COMMIT_MS);
		await flushPromises();

		expect(overrideWrites(mockApiFetch)).toEqual([written]);
	});
});

describe('feature Match Overlay Source Item sections', () => {
	// Bounds (its position and size) and Content start open; the rest start closed behind a summary.
	it.each([
		['Details', 'false', 'Main Match Source'],
		['Bounds', 'true', '401'],
		['Content', 'true', undefined],
		['Appearance', 'false', undefined],
	])('%s starts open: %s', async (section, open, summary) => {
		const { wrapper } = await mountBounds('top-left');
		const found = wrapper.get(`[data-section="${section}"]`);

		expect(found.attributes('data-default-open')).toBe(open);
		expect(found.attributes('data-summary')).toBeTruthy();
		if (summary)
			expect(found.attributes('data-summary')).toContain(summary);
	});
});

describe('feature Match Overlay Source Item: actions', () => {
	// Each action is offered once: the layer row duplicates, removes and hides.
	it.each([
		'Duplicate Source Item',
		'Remove Source Item',
		'Visible',
	])('offers no %s control', async (label) => {
		const { wrapper } = await mountBounds('top-left');

		expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(false);
		expect(wrapper.findAll('[label]').map(field => field.attributes('label'))).not.toContain(label);
	});
});
