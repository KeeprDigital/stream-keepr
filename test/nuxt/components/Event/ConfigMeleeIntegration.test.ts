import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { mountUnderPageGuard } from '~~/test/helpers/mountUnderPageGuard';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ConfigMeleeIntegration from '~/components/Event/ConfigMeleeIntegration.vue';

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

const mockToast = {
	add: vi.fn(),
};
const mockOverlay = {
	create: vi.fn(),
};
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

// Attached, so pressing Save — a submit button — submits the form.
const mountOptions = {
	attachTo: document.body,
	props: { eventId: 1 },
	global: { stubs: nuxtUiStubs },
};

enableAutoUnmount(afterEach);

async function mountComponent() {
	return mount(ConfigMeleeIntegration, mountOptions);
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

async function mountUnderGuard() {
	return mountUnderPageGuard<Wrapper>(ConfigMeleeIntegration, mountOptions);
}

function fieldInput(wrapper: Wrapper, field: string) {
	return wrapper.get(`[data-field="${field}"] input`);
}

function fieldValue(wrapper: Wrapper, field: string) {
	return (fieldInput(wrapper, field).element as HTMLInputElement).value;
}

function button(wrapper: Wrapper, label: string) {
	return wrapper.findAll('button').find(candidate => candidate.text() === label)!;
}

async function disableIntegration(wrapper: Wrapper) {
	await wrapper.get('[role="switch"]').trigger('click');
	await wrapper.get('form').trigger('submit');
	await flushPromises();
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
		const open = vi.fn().mockReturnValue({
			result: Promise.resolve(false),
		});
		mockOverlay.create.mockReturnValue({ open });
		const wrapper = await mountComponent();
		await flushPromises();

		await disableIntegration(wrapper);

		expect(open).toHaveBeenCalledWith(expect.objectContaining({
			title: 'Disable Melee Integration',
			confirmLabel: 'Disable and Clear Data',
		}));
		expect(mockEventRepo.updateMeleeConfig).not.toHaveBeenCalled();
	});

	it('requires destructive confirmation before changing a loaded Melee event', async () => {
		const open = vi.fn().mockReturnValue({
			result: Promise.resolve(false),
		});
		mockOverlay.create.mockReturnValue({ open });
		const wrapper = await mountComponent();
		await flushPromises();

		await fieldInput(wrapper, 'meleeEventId').setValue('67890');
		await wrapper.find('form').trigger('submit');
		await flushPromises();

		expect(open).toHaveBeenCalledWith(expect.objectContaining({
			title: 'Change Melee Event',
			confirmLabel: 'Change Event and Clear Data',
		}));
		expect(mockEventRepo.updateMeleeConfig).not.toHaveBeenCalled();
	});

	it('refreshes all local Melee-derived data after a confirmed destructive change', async () => {
		const open = vi.fn().mockReturnValue({
			result: Promise.resolve(true),
		});
		mockOverlay.create.mockReturnValue({ open });
		const wrapper = await mountComponent();
		await flushPromises();

		await disableIntegration(wrapper);

		expect(mockEventRepo.updateMeleeConfig).toHaveBeenCalledWith(1, expect.objectContaining({
			meleeEnabled: false,
		}));
		expect(mockRefreshAfterMeleeReset).toHaveBeenCalledWith(1);
		expect(mockEventStore.setEvent).toHaveBeenCalledWith({ meleeConfigured: true });
		expect(mockEventStore.loadEvent).not.toHaveBeenCalled();
	});

	it('names the imported structure a reset kept for its manual Rounds or Matches, without storing it on the Event', async () => {
		const open = vi.fn().mockReturnValue({
			result: Promise.resolve(true),
		});
		mockOverlay.create.mockReturnValue({ open });
		const kept = 'Phase "Swiss" was imported from Melee.gg and holds manual Rounds or Matches, so it was kept as a manual Phase';
		mockEventRepo.updateMeleeConfig.mockResolvedValue({
			meleeConfigured: false,
			warnings: [kept],
		});
		const wrapper = await mountComponent();
		await flushPromises();

		await disableIntegration(wrapper);

		expect(open).toHaveBeenCalledWith(expect.objectContaining({
			message: expect.stringContaining('Manual rounds and matches stay'),
		}));
		expect(mockEventStore.setEvent).toHaveBeenCalledWith({ meleeConfigured: false });
		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
			color: 'warning',
			description: kept,
		}));
	});

	it('keeps a committed destructive change successful when the local refresh fails', async () => {
		const open = vi.fn().mockReturnValue({
			result: Promise.resolve(true),
		});
		mockOverlay.create.mockReturnValue({ open });
		mockRefreshAfterMeleeReset.mockRejectedValueOnce(new Error('reload failed'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const wrapper = await mountComponent();
		await flushPromises();

		await disableIntegration(wrapper);

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

	// The banner replaces the form, so it carries both what failed and why (#271).
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

	it('tells the page it has unsaved changes while its form is edited', async () => {
		const { wrapper, pageIsDirty } = await mountUnderGuard();
		await flushPromises();

		expect(pageIsDirty()).toBe(false);

		await fieldInput(wrapper, 'meleeEventId').setValue('67890');
		expect(pageIsDirty()).toBe(true);

		await button(wrapper, 'Reset').trigger('click');
		expect(pageIsDirty()).toBe(false);
	});

	// Rotating a client id resets no imported data, so it goes through without a
	// confirmation — and Save is the only control an operator has to send it.
	it('saves a non-destructive change when the operator presses Save', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await fieldInput(wrapper, 'meleeClientId').setValue('rotated-client-id');
		await button(wrapper, 'Save').trigger('click');
		await flushPromises();

		expect(mockEventRepo.updateMeleeConfig).toHaveBeenCalledWith(1, {
			meleeEnabled: true,
			meleeEventId: '12345',
			meleeClientId: 'rotated-client-id',
		});
		expect(mockOverlay.create).not.toHaveBeenCalled();
		expect(mockRefreshAfterMeleeReset).not.toHaveBeenCalled();
	});
	it('reads clean once a save lands, emptying the secret the server keeps', async () => {
		const { wrapper, pageIsDirty } = await mountUnderGuard();
		await flushPromises();

		await fieldInput(wrapper, 'meleeClientId').setValue('rotated-client-id');
		await fieldInput(wrapper, 'meleeClientSecret').setValue('rotated-secret');
		await button(wrapper, 'Save').trigger('click');
		await flushPromises();

		expect(fieldValue(wrapper, 'meleeClientSecret')).toBe('');
		expect(pageIsDirty()).toBe(false);
	});

	it('keeps an edit typed while the save is in flight unsaved', async () => {
		let land = () => {};
		mockEventRepo.updateMeleeConfig.mockImplementation(() => new Promise((resolve) => {
			land = () => resolve({ meleeConfigured: true });
		}));
		const { wrapper, pageIsDirty } = await mountUnderGuard();
		await flushPromises();

		await fieldInput(wrapper, 'meleeClientId').setValue('rotated-client-id');
		await button(wrapper, 'Save').trigger('click');
		await flushPromises();
		await fieldInput(wrapper, 'meleeClientId').setValue('typed-while-saving');
		land();
		await flushPromises();

		expect(fieldValue(wrapper, 'meleeClientId')).toBe('typed-while-saving');
		expect(pageIsDirty()).toBe(true);
	});
});
