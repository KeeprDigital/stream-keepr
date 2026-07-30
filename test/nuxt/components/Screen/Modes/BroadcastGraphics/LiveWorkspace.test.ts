import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import {
	broadcastGraphicPlayoutState,
	createInitialBroadcastGraphicsLiveState,
	onAirBroadcastGraphicIds,
} from '~~/shared/modules/broadcast-graphics-live-session';

enableAutoUnmount(afterEach);

const mockLiveState = ref<BroadcastGraphicsLiveState>(createInitialBroadcastGraphicsLiveState());
const mockLoadSession = vi.fn();
const mockTake = vi.fn();
const mockOut = vi.fn();
const mockPendingGraphicIds = ref<string[]>([]);
const mockError = ref<string | null>(null);

mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => ({
	loadSession: mockLoadSession,
	take: mockTake,
	out: mockOut,
	get error() {
		return mockError.value;
	},
	isPending: (_screenId: number, graphicId: string) => mockPendingGraphicIds.value.includes(graphicId),
	playoutState: (_screenId: number, graphicId: string) =>
		broadcastGraphicPlayoutState(mockLiveState.value, graphicId),
	onAirGraphicIds: (_screenId: number, graphics: readonly { id: string }[]) =>
		onAirBroadcastGraphicIds(mockLiveState.value, graphics),
}));

const ScreenSettingsCardStub = defineComponent({
	props: { title: { type: String, required: false } },
	template: '<section><h2>{{ title }}</h2><slot /></section>',
});

const UIEmptyStateStub = defineComponent({
	props: { title: { type: String, required: false } },
	template: '<div data-testid="empty-state">{{ title }}</div>',
});

const UBadgeStub = defineComponent({ template: '<span><slot /></span>' });
const UIconStub = defineComponent({ template: '<i />' });
const UFieldGroupStub = defineComponent({ template: '<div><slot /></div>' });
const UButtonStub = defineComponent({
	name: 'UButton',
	props: { disabled: { type: Boolean, default: false } },
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

const lowerThird: BroadcastGraphicConfig = { id: 'lower-third', name: 'Lower Third', items: [] };
const slate: BroadcastGraphicConfig = { id: 'slate', name: 'Slate', items: [] };

async function mountComponent(graphics: BroadcastGraphicConfig[] = [lowerThird, slate]) {
	const componentPath = '../../../../../../../app/components/Screen/Modes/BroadcastGraphics/LiveWorkspace.vue';
	const { default: LiveWorkspace } = await import(componentPath);

	const wrapper = mount(LiveWorkspace, {
		props: {
			eventId: 7,
			screen: { id: 3, slug: 'main' } as Screen,
			graphics,
			selectedGraphicId: null,
			canvasWidth: 1920,
			canvasHeight: 1080,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				UIEmptyState: UIEmptyStateStub,
				UBadge: UBadgeStub,
				UIcon: UIconStub,
				UFieldGroup: UFieldGroupStub,
				UButton: UButtonStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

function entryFor(wrapper: Awaited<ReturnType<typeof mountComponent>>, graphicId: string) {
	return wrapper.get(`[data-playout-entry="${graphicId}"]`);
}

describe('broadcastGraphicsLiveWorkspace', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLiveState.value = createInitialBroadcastGraphicsLiveState();
		mockPendingGraphicIds.value = [];
		mockError.value = null;
	});

	it('loads the authoritative playout snapshot for the Screen', async () => {
		await mountComponent();

		expect(mockLoadSession).toHaveBeenCalledWith(7, 3);
	});

	it('lists every placed Broadcast Graphic with its Graphic Playout State', async () => {
		mockLiveState.value = { playout: { slate: { onAir: true } } };

		const wrapper = await mountComponent();

		expect(entryFor(wrapper, 'lower-third').attributes('data-playout-state')).toBe('off');
		expect(entryFor(wrapper, 'slate').attributes('data-playout-state')).toBe('on-air');
	});

	it('takes a Broadcast Graphic on air', async () => {
		const wrapper = await mountComponent();

		await entryFor(wrapper, 'slate').get('[data-testid="playout-take"]').trigger('click');

		expect(mockTake).toHaveBeenCalledWith(7, 3, 'slate', false);
	});

	it('takes a Broadcast Graphic off air', async () => {
		mockLiveState.value = { playout: { slate: { onAir: true } } };
		const wrapper = await mountComponent();

		await entryFor(wrapper, 'slate').get('[data-testid="playout-out"]').trigger('click');

		expect(mockOut).toHaveBeenCalledWith(7, 3, 'slate', false);
	});

	it('offers Cut variants of both actions', async () => {
		const wrapper = await mountComponent();

		await entryFor(wrapper, 'slate').get('[data-testid="playout-cut-take"]').trigger('click');
		await entryFor(wrapper, 'slate').get('[data-testid="playout-cut-out"]').trigger('click');

		expect(mockTake).toHaveBeenCalledWith(7, 3, 'slate', true);
		expect(mockOut).toHaveBeenCalledWith(7, 3, 'slate', true);
	});

	it('keeps both actions available so a repeat converges on the operator’s latest intent', async () => {
		mockLiveState.value = { playout: { slate: { onAir: true } } };
		const wrapper = await mountComponent();
		const entry = entryFor(wrapper, 'slate');

		expect(entry.get('[data-testid="playout-take"]').attributes('disabled')).toBeUndefined();
		expect(entry.get('[data-testid="playout-out"]').attributes('disabled')).toBeUndefined();
	});

	it('reports how many Broadcast Graphics are on air', async () => {
		mockLiveState.value = { playout: { 'slate': { onAir: true }, 'lower-third': { onAir: true } } };

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="on-air-count"]').text()).toContain('2');
	});

	it('shows an empty stack rather than playout controls when nothing is placed', async () => {
		const wrapper = await mountComponent([]);

		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('No Broadcast Graphics');
		expect(wrapper.find('[data-playout-entry]').exists()).toBe(false);
	});

	it('disables a Broadcast Graphic’s own actions while its action is in flight, and no others', async () => {
		mockPendingGraphicIds.value = ['slate'];

		const wrapper = await mountComponent();

		const slate = entryFor(wrapper, 'slate');
		expect(slate.get('[data-testid="playout-take"]').attributes('disabled')).toBeDefined();
		expect(slate.get('[data-testid="playout-out"]').attributes('disabled')).toBeDefined();
		expect(slate.get('[data-testid="playout-cut-take"]').attributes('disabled')).toBeDefined();
		expect(entryFor(wrapper, 'lower-third').get('[data-testid="playout-take"]').attributes('disabled')).toBeUndefined();
	});

	it('surfaces a failed playout action instead of failing silently on air', async () => {
		mockError.value = 'Broadcast graphics live session has ended';

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="playout-error"]').text()).toContain('live session has ended');
	});

	it('shows no error banner while playout is healthy', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="playout-error"]').exists()).toBe(false);
	});

	it('selects a Broadcast Graphic without changing what is on air', async () => {
		const wrapper = await mountComponent();

		await entryFor(wrapper, 'slate').get('[data-testid="playout-select"]').trigger('click');

		expect(wrapper.emitted('select')).toEqual([['slate']]);
		expect(mockTake).not.toHaveBeenCalled();
	});
});
