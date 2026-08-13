import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import { mountUnderPageGuard } from '~~/test/helpers/mountUnderPageGuard';
import { transportFailure } from '~~/test/helpers/transportFailure';

const mockEventStore = reactive({
	event: {
		id: 1,
		meleeEnabled: true,
		meleeConfigured: true,
		liveMatchRefreshEnabled: true,
		liveMatchRefreshIntervalSeconds: 45,
		initialSetupCompletedAt: new Date('2026-04-09T10:00:00.000Z') as Date | null,
		lastEventSyncedAt: new Date('2026-04-09T10:05:00.000Z') as Date | null,
		lastPlayersSyncedAt: new Date('2026-04-09T10:10:00.000Z') as Date | null,
		lastDecklistsSyncedAt: new Date('2026-04-09T10:12:00.000Z') as Date | null,
		lastSyncError: null as string | null,
	},
	loadEvent: vi.fn(),
	setEvent: vi.fn(),
});

const mockEventRepo = {
	getMeleeConfig: vi.fn(async () => ({
		meleeEnabled: true,
		meleeConfigured: true,
		meleeEventId: '12345',
		meleeClientId: 'client-id',
		liveMatchRefreshEnabled: true,
		liveMatchRefreshIntervalSeconds: 45,
	})),
	updateMeleeConfig: vi.fn(),
};

const mockToast = { add: vi.fn() };
const mockOverlay = { create: vi.fn() };
const mockRefreshAfterMeleeReset = vi.fn();

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useEventRepository', () => () => mockEventRepo);
mockNuxtImport('useToast', () => () => mockToast);
mockNuxtImport('useOverlay', () => () => mockOverlay);
mockNuxtImport('useMeleeDataRefresh', () => () => ({
	refreshAfterMeleeReset: mockRefreshAfterMeleeReset,
}));
// The page guard installs a route leave hook. What it does with it is its own
// composable's test; here it only has to exist so a test can mount this card the
// way its page does.
mockNuxtImport('onBeforeRouteLeave', () => () => {});

const UFormStub = defineComponent({
	emits: ['submit'],
	template: '<form @submit.prevent="$emit(\'submit\')"><slot /></form>',
});

const UCardStub = defineComponent({
	template: '<section><slot name="header" /><slot /><slot name="footer" /></section>',
});

const UFormFieldStub = defineComponent({
	props: { name: { type: String, required: false } },
	template: '<label :data-field="name"><slot /></label>',
});

// UButton takes `type` as a prop and leaves the default to ULink, which is
// "button". Declaring it here rather than hardcoding one on the root says that
// out loud: the footer's "submit" has to reach the rendered button for pressing
// Save to submit anything.
const UButtonStub = defineComponent({
	props: {
		label: { type: String, required: false },
		disabled: { type: Boolean, required: false },
		type: { type: String, required: false, default: 'button' },
	},
	template: '<button :type="type" :data-label="label" :disabled="disabled"><slot>{{ label }}</slot></button>',
});

const UInputStub = defineComponent({
	props: {
		modelValue: { type: [String, Number], required: false },
	},
	emits: ['update:modelValue'],
	template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
});

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue ?? 0">',
});

const USwitchStub = defineComponent({
	props: {
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)">',
});

const componentPath = '../../../../app/components/Event/ConfigMeleeIntegration.vue';

// A detached button has no activation behaviour, so pressing a submit button
// only submits its form once the tree is in the document.
const mountOptions = {
	attachTo: document.body,
	props: {
		eventId: 1,
	},
	global: {
		stubs: {
			UForm: UFormStub,
			UCard: UCardStub,
			UFormField: UFormFieldStub,
			UButton: UButtonStub,
			UInput: UInputStub,
			UInputNumber: UInputNumberStub,
			USwitch: USwitchStub,
			USeparator: true,
			UIcon: true,
		},
	},
};

enableAutoUnmount(afterEach);

async function mountComponent() {
	const { default: ConfigMeleeIntegration } = await import(componentPath);

	return mount(ConfigMeleeIntegration, mountOptions);
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

/**
 * Mounts the card the way `pages/event/[eventId]/config/integrations.vue` does,
 * inside a page that has installed the unsaved-changes guard. See the shared
 * harness for why the registration is invisible from a bare mount.
 */
async function mountUnderGuard() {
	const { default: ConfigMeleeIntegration } = await import(componentPath);

	return mountUnderPageGuard<Wrapper>(ConfigMeleeIntegration, mountOptions);
}

function fieldInput(wrapper: Wrapper, field: string) {
	return wrapper.get(`[data-field="${field}"]`).getComponent(UInputStub);
}

describe('configMeleeIntegration', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-04-09T10:15:00.000Z'));
		mockEventStore.event = {
			id: 1,
			meleeEnabled: true,
			meleeConfigured: true,
			liveMatchRefreshEnabled: true,
			liveMatchRefreshIntervalSeconds: 45,
			initialSetupCompletedAt: new Date('2026-04-09T10:00:00.000Z'),
			lastEventSyncedAt: new Date('2026-04-09T10:05:00.000Z'),
			lastPlayersSyncedAt: new Date('2026-04-09T10:10:00.000Z'),
			lastDecklistsSyncedAt: new Date('2026-04-09T10:12:00.000Z'),
			lastSyncError: null,
		};
		mockEventRepo.getMeleeConfig.mockClear();
		mockEventRepo.updateMeleeConfig.mockReset().mockResolvedValue({ meleeConfigured: true });
		mockEventStore.loadEvent.mockReset().mockResolvedValue(undefined);
		mockEventStore.setEvent.mockReset();
		mockToast.add.mockClear();
		mockOverlay.create.mockClear();
		mockRefreshAfterMeleeReset.mockReset().mockResolvedValue(undefined);
	});

	it('requires destructive confirmation before disabling a loaded integration', async () => {
		const open = vi.fn().mockReturnValue({ result: Promise.resolve(false) });
		mockOverlay.create.mockReturnValue({ open });
		const wrapper = await mountComponent();
		await flushPromises();

		await wrapper.find('input[type="checkbox"]').setValue(false);
		await wrapper.find('form').trigger('submit');
		await flushPromises();

		expect(open).toHaveBeenCalledWith(expect.objectContaining({
			title: 'Disable Melee Integration',
			confirmLabel: 'Disable and Clear Data',
		}));
		expect(mockEventRepo.updateMeleeConfig).not.toHaveBeenCalled();
	});

	it('requires destructive confirmation before changing a loaded Melee event', async () => {
		const open = vi.fn().mockReturnValue({ result: Promise.resolve(false) });
		mockOverlay.create.mockReturnValue({ open });
		const wrapper = await mountComponent();
		await flushPromises();

		await wrapper.findAll('input').find(input => input.attributes('type') !== 'checkbox')!.setValue('67890');
		await wrapper.find('form').trigger('submit');
		await flushPromises();

		expect(open).toHaveBeenCalledWith(expect.objectContaining({
			title: 'Change Melee Event',
			confirmLabel: 'Change Event and Clear Data',
		}));
		expect(mockEventRepo.updateMeleeConfig).not.toHaveBeenCalled();
	});

	it('refreshes all local Melee-derived data after a confirmed destructive change', async () => {
		const open = vi.fn().mockReturnValue({ result: Promise.resolve(true) });
		mockOverlay.create.mockReturnValue({ open });
		const wrapper = await mountComponent();
		await flushPromises();

		await wrapper.find('input[type="checkbox"]').setValue(false);
		await wrapper.find('form').trigger('submit');
		await flushPromises();

		expect(mockEventRepo.updateMeleeConfig).toHaveBeenCalledWith(1, expect.objectContaining({
			meleeEnabled: false,
		}));
		expect(mockRefreshAfterMeleeReset).toHaveBeenCalledWith(1);
		expect(mockEventStore.setEvent).toHaveBeenCalledWith({ meleeConfigured: true });
		expect(mockEventStore.loadEvent).not.toHaveBeenCalled();
	});

	it('keeps a committed destructive change successful when the local refresh fails', async () => {
		const open = vi.fn().mockReturnValue({ result: Promise.resolve(true) });
		mockOverlay.create.mockReturnValue({ open });
		mockRefreshAfterMeleeReset.mockRejectedValueOnce(new Error('reload failed'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const wrapper = await mountComponent();
		await flushPromises();

		await wrapper.find('input[type="checkbox"]').setValue(false);
		await wrapper.find('form').trigger('submit');
		await flushPromises();

		expect(mockEventRepo.updateMeleeConfig).toHaveBeenCalledOnce();
		expect(mockEventStore.setEvent).toHaveBeenCalledWith({ meleeConfigured: true });
		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
			color: 'warning',
			description: expect.stringContaining('Reload this page'),
		}));
		expect(mockToast.add).not.toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
		warn.mockRestore();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	/**
	 * What the card says when its configuration read is refused.
	 *
	 * This banner replaces the whole form, so it has to carry standing context — and it
	 * used to carry only that: `runRequest` wrote `getErrorMessage`'s answer into
	 * `errorRef` and `onFailure` overwrote it with static wording one line later, so the
	 * reason never survived (#271 recorded the dead write). One writer now composes both.
	 */
	it('names what failed and quotes the refusal the server wrote', async () => {
		mockEventRepo.getMeleeConfig.mockRejectedValueOnce(transportFailure({
			status: 403,
			body: { message: 'This Event belongs to another installation' },
			request: `[GET] "/api/events/1/melee/config"`,
		}));
		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.text()).toContain('Melee configuration could not be loaded');
		expect(wrapper.text()).toContain('This Event belongs to another installation');
	});

	it('relays a preserved 503 naming the setting that was never configured', async () => {
		mockEventRepo.getMeleeConfig.mockRejectedValueOnce(transportFailure({
			status: 503,
			body: { message: 'NUXT_MELEE_CREDENTIAL_KEY is not configured' },
			request: `[GET] "/api/events/1/melee/config"`,
		}));
		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.text()).toContain('NUXT_MELEE_CREDENTIAL_KEY is not configured');
	});

	it('renders only the Melee integration configuration form', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(mockEventRepo.getMeleeConfig).toHaveBeenCalledWith(1);
		expect(wrapper.text()).toContain('Reset');
		expect(wrapper.text()).toContain('Save');
		expect(wrapper.text()).not.toContain('Melee Sync Summary');
		expect(wrapper.text()).not.toContain('Open Melee Sync');
		expect(wrapper.find('.divide-y.divide-default').exists()).toBe(false);
		expect(wrapper.findAll('section')).toHaveLength(1);
	});

	// The guard is what stops an operator navigating away from an unsaved edit. It
	// registers through inject, so a card mounted without a page around it
	// registers with nothing and loses this silently.
	it('tells the page it has unsaved changes while its form is edited', async () => {
		const { wrapper, pageIsDirty } = await mountUnderGuard();
		await flushPromises();

		expect(pageIsDirty()).toBe(false);

		await fieldInput(wrapper, 'meleeEventId').setValue('67890');
		expect(pageIsDirty()).toBe(true);

		await wrapper.get('[data-label="Reset"]').trigger('click');
		expect(pageIsDirty()).toBe(false);
	});

	// Rotating a client id resets no imported data, so it goes through without a
	// confirmation — and Save is the only control an operator has to send it.
	it('saves a non-destructive change when the operator presses Save', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await fieldInput(wrapper, 'meleeClientId').setValue('rotated-client-id');
		await wrapper.get('[data-label="Save"]').trigger('click');
		await flushPromises();

		expect(mockEventRepo.updateMeleeConfig).toHaveBeenCalledWith(1, {
			meleeEnabled: true,
			meleeEventId: '12345',
			meleeClientId: 'rotated-client-id',
		});
		expect(mockOverlay.create).not.toHaveBeenCalled();
		expect(mockRefreshAfterMeleeReset).not.toHaveBeenCalled();
	});
});
