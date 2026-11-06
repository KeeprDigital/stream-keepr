import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { screenSettingsCardSpies, settingsCards, settingsCardSummary } from '~~/test/nuxt/helpers/screenSettingsCards';
import Settings from '~/components/Screen/Modes/RoundClock/Settings.vue';

// The Round Clock's settings: the Round it times, then the Round name and the
// clock, each card ending with the Look of what it styles (#983).

enableAutoUnmount(afterEach);

const mockConfig = ref<Record<string, any>>({});
const mockUpdateConfig = vi.fn((patch: Record<string, unknown>) => {
	mockConfig.value = {
		...mockConfig.value,
		...patch,
	};
});
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: mockConfig,
	saving: ref(false),
	updateConfig: mockUpdateConfig,
	resetConfig: vi.fn(),
}));

/** The shared Round picker, tested at its home; here it names its null option and emits a Round. */
const RoundFieldStub = defineComponent({
	props: {
		modelValue: { type: Number, default: null },
		nullLabel: { type: String, required: true },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-round-field :data-null-label="nullLabel" @click="$emit(\'update:modelValue\', modelValue === 31 ? null : 31)" />',
});

async function mountSettings() {
	const wrapper = mount(Settings, {
		props: {
			screen: { id: 1 } as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				...screenSettingsCardSpies,
				ScreenRoundField: RoundFieldStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('screenRoundClockSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = {
			...getDefaultConfigForMode('round-clock'),
		};
	});

	it('orders its cards Data, Round Name, Clock, each Look in the card it styles', async () => {
		const wrapper = await mountSettings();

		expect(settingsCards(wrapper)).toEqual([
			{
				title: 'Data',
				id: 'round-clock:data',
				collapsible: false,
				looks: [],
			},
			{
				title: 'Round Name',
				id: 'round-clock:round-name',
				collapsible: true,
				looks: ['round-name'],
			},
			{
				title: 'Clock',
				id: 'round-clock:clock',
				collapsible: true,
				looks: ['clock'],
			},
		]);
	});

	it.each([
		[undefined, 31],
		[31, null],
	])('picks the Round from %s to %s, unset following the Current Round', async (stored, written) => {
		mockConfig.value = { ...mockConfig.value, roundId: stored };
		const wrapper = await mountSettings();
		const picker = wrapper.get('[data-round-field]');

		expect(picker.attributes('data-null-label')).toBe('Current Round');
		await picker.trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ roundId: written });
	});

	it.each([
		[true, false, 'Hidden'],
		[false, true, 'Shown above the clock'],
	])('switches the Round name from %s to %s, summarised when closed', async (shown, written, summary) => {
		mockConfig.value = { ...mockConfig.value, showRoundName: shown };
		const wrapper = await mountSettings();

		await wrapper.get('[data-config-field="showRoundName"] [role="switch"]').trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ showRoundName: written });
		expect(settingsCardSummary(wrapper, 'Round Name')).toBe(summary);
	});

	// The limit is offered only while counting up; emptied, it counts up without one.
	it.each([
		[false, undefined, 'Holds 0:00 after the Round'],
		[true, undefined, 'Counts up after the Round, without limit'],
		[true, 10, 'Counts up after the Round, up to 10 min'],
	])('counting up %s with a limit of %s, summarises the clock as "%s"', async (countUpAfterEnd, countUpLimitMinutes, summary) => {
		mockConfig.value = { ...mockConfig.value, countUpAfterEnd, countUpLimitMinutes };
		const wrapper = await mountSettings();

		expect(settingsCardSummary(wrapper, 'Clock')).toBe(summary);
		expect(wrapper.find('[data-config-field="countUpLimitMinutes"]').exists()).toBe(countUpAfterEnd);
	});

	it.each([
		['', null],
		['15', 15],
	])('writes a typed count-up limit "%s" as %s', async (typed, written) => {
		mockConfig.value = { ...mockConfig.value, countUpAfterEnd: true, countUpLimitMinutes: 5 };
		const wrapper = await mountSettings();

		await wrapper.get('[data-config-field="countUpLimitMinutes"] input').setValue(typed);

		expect(mockUpdateConfig).toHaveBeenCalledWith({ countUpLimitMinutes: written });
	});

	it('switches counting up on', async () => {
		const wrapper = await mountSettings();

		await wrapper.get('[data-config-field="countUpAfterEnd"] [role="switch"]').trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ countUpAfterEnd: true });
		expect(wrapper.find('[data-config-field="countUpLimitMinutes"]').exists()).toBe(true);
	});
});
