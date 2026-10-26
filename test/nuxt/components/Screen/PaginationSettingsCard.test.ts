import type { PageRotationMode } from '~~/shared/screenModes';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import PaginationSettingsCard from '~/components/Screen/PaginationSettingsCard.vue';
import { useRotationConfigWrites } from '~/modules/screen-mode/rotationWrites';

/**
 * The one Pagination card every paginated Screen Mode's settings render. It is
 * driven by the mode's Page Rotation declaration, so a mode naming its page
 * size field differently (Metagame `pageSize`) needs no special case, and it
 * writes only through the Page Rotation writes (ADR-0009, ADR-0039).
 */

// Server time is the Page Rotation's clock; fractional, like a real sync.
mockNuxtImport('useServerTime', () => () => ({
	isSynced: ref(true),
	serverTimeOffset: ref(0),
	getServerTime: () => 1_000_000.25,
}));

const ScreenSettingsToggleStub = defineComponent({
	props: {
		label: { type: String, required: true },
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="settings-toggle" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>',
});

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, required: false },
		description: { type: String, required: false },
	},
	template: '<div data-testid="form-field"><span>{{ label }}</span><span>{{ description }}</span><slot /></div>',
});

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
		min: { type: Number, required: false },
		max: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<div data-testid="u-input-number" :data-min="min" :data-max="max">{{ modelValue }}</div>',
});

const UButtonStub = defineComponent({
	props: {
		label: { type: String, required: false },
		disabled: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
});

interface Harness {
	mode: PageRotationMode;
	config: Record<string, unknown>;
	rowCount: number;
	loading?: boolean;
}

function mountCard({ mode, config: overrides, rowCount, loading }: Harness) {
	const config = ref<Record<string, any>>({
		...getDefaultConfigForMode(mode),
		...overrides,
	});
	const saveConfig = vi.fn((patch: Record<string, unknown>) => {
		config.value = {
			...config.value,
			...patch,
		};
	});
	const Host = defineComponent({
		setup() {
			const rotation = useRotationConfigWrites({
				mode,
				config: computed(() => config.value as any),
				rowCount: computed(() => rowCount),
				saveConfig,
			});
			return () => h(PaginationSettingsCard, {
				rotation,
				pageSizeDescription: 'Rows on each page.',
				autoPageDescription: 'Cycle through the pages.',
				loading,
			});
		},
	});
	const wrapper = mount(Host, {
		global: {
			stubs: {
				ScreenSettingsCard: {
					props: ['title'],
					template: '<section><h2>{{ title }}</h2><slot /></section>',
				},
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				UFormField: UFormFieldStub,
				UInputNumber: UInputNumberStub,
				UButton: UButtonStub,
				USeparator: true,
			},
		},
	});
	return { wrapper, saveConfig };
}

function numberInput(wrapper: ReturnType<typeof mountCard>['wrapper'], label: string) {
	const field = wrapper.findAll('[data-testid="form-field"]').find(item => item.text().includes(label));
	expect(field, label).toBeDefined();
	return field!.getComponent(UInputNumberStub);
}

function button(wrapper: ReturnType<typeof mountCard>['wrapper'], label: string) {
	const found = wrapper.findAll('button').find(item => item.text() === label);
	expect(found, label).toBeDefined();
	return found!;
}

describe('the shared Pagination settings card', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('edits the page size field the mode declares, with its contract label and bounds', () => {
		const { wrapper, saveConfig } = mountCard({
			mode: 'metagame',
			config: { pageSize: 6, currentPage: 2 },
			rowCount: 20,
		});

		const pageSize = numberInput(wrapper, 'Rows per page');
		expect(pageSize.props()).toMatchObject({ modelValue: 6, min: 1, max: 100 });
		expect(wrapper.text()).toContain('Rows on each page.');

		pageSize.vm.$emit('update:modelValue', 8);

		expect(saveConfig).toHaveBeenCalledWith({ pageSize: 8, currentPage: 1 });
	});

	it('restarts a running rotation from page 1 when the page size changes', () => {
		const { wrapper, saveConfig } = mountCard({
			mode: 'standings',
			config: { autoPageEnabled: true },
			rowCount: 20,
		});

		numberInput(wrapper, 'Rows per page').vm.$emit('update:modelValue', 4);

		expect(saveConfig).toHaveBeenCalledWith({ rowsPerPage: 4, currentPage: 1, rotationAnchor: 1_000_000 });
	});

	it('anchors the rotation when auto-page is switched on, and shows its interval in seconds', async () => {
		const { wrapper, saveConfig } = mountCard({
			mode: 'pairings',
			config: { autoPageEnabled: false },
			rowCount: 20,
		});
		expect(wrapper.text()).not.toContain('Interval (seconds)');

		await wrapper.get('[data-testid="settings-toggle"]').trigger('click');

		expect(saveConfig).toHaveBeenCalledWith({ autoPageEnabled: true, rotationAnchor: 1_000_000 });
		expect(numberInput(wrapper, 'Interval (seconds)').props()).toMatchObject({ modelValue: 10, min: 3, max: 60 });
	});

	it('writes an interval edit in milliseconds, restarting the running rotation', () => {
		const { wrapper, saveConfig } = mountCard({
			mode: 'player-history',
			config: { autoPageEnabled: true, currentPage: 2 },
			rowCount: 20,
		});

		numberInput(wrapper, 'Interval (seconds)').vm.$emit('update:modelValue', 5);

		expect(saveConfig).toHaveBeenCalledWith({ autoPageIntervalMs: 5000, rotationAnchor: 1_000_000 });
	});

	it('counts pages from the row count it is given and selects pages manually, wrapping at the ends', async () => {
		const { wrapper, saveConfig } = mountCard({
			mode: 'metagame',
			config: { pageSize: 5, currentPage: 1 },
			rowCount: 12,
		});
		expect(wrapper.text()).toContain('Page 1 of 3');

		await button(wrapper, 'Next').trigger('click');
		expect(saveConfig).toHaveBeenLastCalledWith({ currentPage: 2 });
		expect(wrapper.text()).toContain('Page 2 of 3');

		await button(wrapper, 'Previous').trigger('click');
		await button(wrapper, 'Previous').trigger('click');
		expect(saveConfig).toHaveBeenLastCalledWith({ currentPage: 3 });
	});

	it('disables manual selection with only one page or while the rows load', () => {
		const onePage = mountCard({
			mode: 'archetype-spotlight',
			config: { rowsPerPage: 8 },
			rowCount: 8,
		});
		expect(button(onePage.wrapper, 'Next').attributes('disabled')).toBeDefined();

		const loading = mountCard({
			mode: 'archetype-spotlight',
			config: { rowsPerPage: 2 },
			rowCount: 8,
			loading: true,
		});
		expect(loading.wrapper.text()).toContain('Page 1 of 4');
		expect(button(loading.wrapper, 'Previous').attributes('disabled')).toBeDefined();
		expect(button(loading.wrapper, 'Next').attributes('disabled')).toBeDefined();
	});
});
