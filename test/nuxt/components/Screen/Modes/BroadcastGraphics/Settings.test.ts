import type { BroadcastGraphicsModeConfig } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, reactive, ref } from 'vue';

enableAutoUnmount(afterEach);

const mockConfig = ref<BroadcastGraphicsModeConfig>({ graphics: [] });
const mockScreenConfig = ref({ width: 1920, height: 1080 });
const mockRoute = reactive({
	query: {} as Record<string, unknown>,
	params: {},
	path: '/event/1/screens/1',
	fullPath: '/event/1/screens/1',
	hash: '',
	meta: {},
	matched: [],
});
const mockReplace = vi.fn((location: { query: Record<string, unknown> }) => {
	mockRoute.query = Object.fromEntries(
		Object.entries(location.query).filter(([, value]) => value !== undefined),
	);
	return Promise.resolve();
});
const mockUpdateConfig = vi.fn((patch: Record<string, unknown>) => {
	mockConfig.value = { ...mockConfig.value, ...patch } as BroadcastGraphicsModeConfig;
});
const mockUpdateScreenConfig = vi.fn((patch: Record<string, unknown>) => {
	mockScreenConfig.value = { ...mockScreenConfig.value, ...patch };
});

mockNuxtImport('useRoute', () => () => mockRoute);
mockNuxtImport('useRouter', () => () => ({
	replace: mockReplace,
	afterEach: () => () => {},
	beforeEach: () => () => {},
	beforeResolve: () => () => {},
}));
mockNuxtImport('useScreenStore', () => () => ({ updateScreenConfig: vi.fn().mockResolvedValue(undefined) }));
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: mockConfig,
	saving: ref(false),
	updateConfig: mockUpdateConfig,
	resetConfig: vi.fn(),
}));
const mockLeaseWritable = ref(true);
const mockLeaseEnabled = ref<boolean | null>(null);
const mockTakeOver = vi.fn();
mockNuxtImport('useGraphicsAuthoringLease', () => (options: { enabled?: () => boolean }) => {
	mockLeaseEnabled.value = options.enabled?.() ?? true;
	return {
		lease: ref(null),
		status: ref('ready'),
		writable: mockLeaseWritable,
		heldByAnotherSession: computed(() => !mockLeaseWritable.value),
		canTakeOver: computed(() => !mockLeaseWritable.value),
		refresh: vi.fn(),
		takeOver: mockTakeOver,
		release: vi.fn(),
	};
});
mockNuxtImport('useScreenConfigUpdate', () => () => ({
	screenConfig: mockScreenConfig,
	saving: ref(false),
	updateScreenConfig: mockUpdateScreenConfig,
	resetScreenConfig: vi.fn(),
}));

const EditWorkspaceStub = defineComponent({
	props: {
		graphics: { type: Array, required: true },
		selectedTarget: { type: Object, required: true },
		selectedGraphicId: { type: String, default: null },
		writable: { type: Boolean, default: true },
		canTakeOver: { type: Boolean, default: false },
	},
	emits: ['update:graphics', 'update:selectedTarget', 'takeOver'],
	template: `<div
		data-testid="edit-workspace"
		:data-selected-graphic="selectedGraphicId ?? ''"
		:data-selected-target="JSON.stringify(selectedTarget)"
		:data-writable="String(writable)"
		:data-can-take-over="String(canTakeOver)"
	/>`,
});

const LiveWorkspaceStub = defineComponent({
	props: {
		graphics: { type: Array, required: true },
		selectedGraphicId: { type: String, default: null },
	},
	emits: ['select'],
	template: `<button
		data-testid="live-workspace"
		:data-selected-graphic="selectedGraphicId ?? ''"
		@click="$emit('select', 'slate')"
	/>`,
});

const UFormFieldStub = defineComponent({
	props: { label: { type: String, required: false } },
	template: '<div><span>{{ label }}</span><slot /></div>',
});

const UFieldGroupStub = defineComponent({ template: '<div><slot /></div>' });

const UButtonStub = defineComponent({
	name: 'UButton',
	emits: ['click'],
	template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
});

const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: {
		modelValue: { type: Number, required: false },
		disabled: { type: Boolean, default: false },
	},
	emits: ['update:modelValue'],
	template: '<input :value="modelValue" :disabled="disabled">',
});

async function mountComponent() {
	const componentPath = '../../../../../../../app/components/Screen/Modes/BroadcastGraphics/Settings.vue';
	const { default: Settings } = await import(componentPath);

	return mount(Settings, {
		props: {
			screen: { id: 1, slug: 'main', screenConfig: { width: 1920, height: 1080 } } as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				BroadcastGraphicsEditWorkspace: EditWorkspaceStub,
				BroadcastGraphicsLiveWorkspace: LiveWorkspaceStub,
				UFormField: UFormFieldStub,
				UFieldGroup: UFieldGroupStub,
				UButton: UButtonStub,
				UInputNumber: UInputNumberStub,
			},
		},
	});
}

describe('broadcastGraphicsSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = {
			graphics: [
				{ id: 'lower-third', name: 'Lower Third', items: [] },
				{ id: 'slate', name: 'Slate', items: [] },
			],
		};
		mockScreenConfig.value = { width: 1920, height: 1080 };
		mockRoute.query = {};
		mockLeaseWritable.value = true;
		mockLeaseEnabled.value = null;
	});

	it('opens the Screen configuration page on the Live workspace', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.find('[data-testid="live-workspace"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="edit-workspace"]').exists()).toBe(false);
	});

	it('addresses the Edit workspace from the URL', async () => {
		mockRoute.query = { workspace: 'edit' };

		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.find('[data-testid="edit-workspace"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="live-workspace"]').exists()).toBe(false);
	});

	it('preserves the selected Broadcast Graphic when moving between workspaces', async () => {
		mockRoute.query = { workspace: 'edit', graphic: 'slate' };

		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.get('[data-testid="edit-workspace"]').attributes('data-selected-graphic')).toBe('slate');

		await wrapper.get('[data-testid="workspace-live"]').trigger('click');
		await nextTick();

		expect(mockRoute.query).toEqual({ graphic: 'slate' });
		expect(wrapper.get('[data-testid="live-workspace"]').attributes('data-selected-graphic')).toBe('slate');
	});

	it('records a selection made in the Live workspace in the URL', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await wrapper.get('[data-testid="live-workspace"]').trigger('click');
		await nextTick();

		expect(mockRoute.query.graphic).toBe('slate');
	});

	it('forgets a URL selection the Screen stack no longer carries', async () => {
		mockRoute.query = { workspace: 'edit', graphic: 'deleted' };

		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.get('[data-testid="edit-workspace"]').attributes('data-selected-graphic')).toBe('');
		expect(wrapper.get('[data-testid="edit-workspace"]').attributes('data-selected-target'))
			.toBe(JSON.stringify({ type: 'canvas' }));
	});

	it('writes an authored stack change as Screen-owned mode configuration', async () => {
		mockRoute.query = { workspace: 'edit' };

		const wrapper = await mountComponent();
		await flushPromises();

		const next = [{ id: 'bug', name: 'Bug', items: [] }];
		wrapper.getComponent(EditWorkspaceStub).vm.$emit('update:graphics', next);
		await nextTick();

		expect(mockUpdateConfig).toHaveBeenCalledWith({ graphics: next });
	});

	it('keeps the Broadcast Graphics canvas with the mode settings', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const inputs = wrapper.findAllComponents({ name: 'UInputNumber' });
		expect(inputs.map(input => input.props('modelValue'))).toEqual([1920, 1080]);

		await inputs[1]?.vm.$emit('update:modelValue', 720);
		await nextTick();

		expect(mockUpdateScreenConfig).toHaveBeenCalledWith({ height: 720 });
	});
	it('refuses an authoring write from a session observing the Edit workspace read-only', async () => {
		mockRoute.query = { workspace: 'edit' };
		mockLeaseWritable.value = false;

		const wrapper = await mountComponent();
		await flushPromises();

		const workspace = wrapper.get('[data-testid="edit-workspace"]');
		expect(workspace.attributes('data-writable')).toBe('false');
		expect(workspace.attributes('data-can-take-over')).toBe('true');

		wrapper.getComponent(EditWorkspaceStub).vm.$emit('update:graphics', [{ id: 'bug', name: 'Bug', items: [] }]);
		await nextTick();

		expect(mockUpdateConfig).not.toHaveBeenCalled();
	});

	it('takes the Graphics Authoring Lease over on the observer\'s explicit request', async () => {
		mockRoute.query = { workspace: 'edit' };
		mockLeaseWritable.value = false;

		const wrapper = await mountComponent();
		await flushPromises();

		wrapper.getComponent(EditWorkspaceStub).vm.$emit('takeOver');
		await nextTick();

		expect(mockTakeOver).toHaveBeenCalled();
	});

	it('asks for the Graphics Authoring Lease only while the Edit workspace is open', async () => {
		await mountComponent();
		await flushPromises();

		expect(mockLeaseEnabled.value).toBe(false);

		mockRoute.query = { workspace: 'edit' };
		await mountComponent();
		await flushPromises();

		expect(mockLeaseEnabled.value).toBe(true);
	});

	it('never lets a lease restrict the Live workspace', async () => {
		mockLeaseWritable.value = false;

		const wrapper = await mountComponent();
		await flushPromises();

		// The Live workspace is rendered, carries the whole Screen stack, and its
		// interactions work — for an operator holding no lease at all.
		const live = wrapper.get('[data-testid="live-workspace"]');
		expect(wrapper.getComponent(LiveWorkspaceStub).props('graphics')).toHaveLength(2);
		expect(wrapper.find('[data-testid="edit-lease-notice"]').exists()).toBe(false);

		await live.trigger('click');
		await nextTick();

		expect(mockRoute.query.graphic).toBe('slate');

		// And the lease is never even asked for from here.
		expect(mockLeaseEnabled.value).toBe(false);
	});

	it('leaves the canvas open to a Live operator who holds no lease', async () => {
		mockLeaseWritable.value = false;

		const wrapper = await mountComponent();
		await flushPromises();

		const inputs = wrapper.findAllComponents({ name: 'UInputNumber' });
		expect(inputs.map(input => input.props('disabled'))).toEqual([false, false]);

		await inputs[1]?.vm.$emit('update:modelValue', 720);
		await nextTick();

		expect(mockUpdateScreenConfig).toHaveBeenCalledWith({ height: 720 });
	});

	it('closes the canvas to a session observing the Edit workspace read-only', async () => {
		mockRoute.query = { workspace: 'edit' };
		mockLeaseWritable.value = false;

		const wrapper = await mountComponent();
		await flushPromises();

		const inputs = wrapper.findAllComponents({ name: 'UInputNumber' });
		expect(inputs.map(input => input.props('disabled'))).toEqual([true, true]);

		await inputs[1]?.vm.$emit('update:modelValue', 720);
		await nextTick();

		expect(mockUpdateScreenConfig).not.toHaveBeenCalled();
	});
});
