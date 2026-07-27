import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

const {
	mockApiFetch,
	mockCapacityRefresh,
	mockRefresh,
} = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
	mockCapacityRefresh: vi.fn(),
	mockRefresh: vi.fn(),
}));

const health = ref({
	status: 'degraded',
	checkedAt: '2026-07-27T04:00:00.000Z',
	catalogue: {
		status: 'unavailable',
		reason: { code: 'catalogue-unavailable', retryable: true },
	},
	byteStores: {
		staging: {
			status: 'unavailable',
			reason: { code: 'byte-store-unavailable', retryable: true },
		},
		canonical: { status: 'healthy' },
	},
});
const capacity = ref({
	canonical: {
		limitBytes: 100 * 1024 * 1024 * 1024,
		usedBytes: 75,
		reservedBytes: 5,
		availableBytes: 100 * 1024 * 1024 * 1024 - 80,
		pressure: 'normal',
		breakdown: {
			retainedSourceBytes: 50,
			retainedDerivativeBytes: 25,
			metadataBytes: 0,
			providerCacheBytes: 0,
			unreachableQuarantineBytes: 0,
		},
	},
	staging: {
		limitBytes: 10 * 1024 * 1024 * 1024,
		usedBytes: 20,
		reservedBytes: 10,
		availableBytes: 10 * 1024 * 1024 * 1024 - 30,
	},
});

mockNuxtImport('$fetch', () => mockApiFetch);
mockNuxtImport('useFetch', () => (path: string) => ({
	data: path === '/api/admin/graphics-assets/capacity' ? capacity : health,
	status: ref('success'),
	error: ref(null),
	refresh: path === '/api/admin/graphics-assets/capacity' ? mockCapacityRefresh : mockRefresh,
}));

const passthroughStub = defineComponent({ template: '<div><slot name="actions" /><slot /></div>' });
const badgeStub = defineComponent({
	props: ['label'],
	template: '<span><slot />{{ label }}</span>',
});
const buttonStub = defineComponent({
	props: ['label'],
	emits: ['click'],
	template: '<button @click="$emit(\'click\')"><slot />{{ label }}</button>',
});
const inputStub = defineComponent({
	props: ['modelValue'],
	emits: ['update:modelValue'],
	template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))">',
});

async function mountPage() {
	const { default: HealthPage } = await import('../../../../../app/pages/admin/graphics-assets/health.vue');
	return mount(HealthPage, {
		global: {
			stubs: {
				NuxtLayout: passthroughStub,
				UAlert: passthroughStub,
				UButton: buttonStub,
				UCard: passthroughStub,
				UBadge: badgeStub,
				UIcon: passthroughStub,
				UFormField: passthroughStub,
				UInput: inputStub,
			},
		},
	});
}

describe('the Graphics Asset Library health page', () => {
	it('shows catalogue, staging, and canonical health as separate administrator results', async () => {
		const wrapper = await mountPage();

		expect(wrapper.text()).toContain('Graphics Asset Library health');
		expect(wrapper.text()).toContain('D1 catalogue');
		expect(wrapper.text()).toContain('Staging byte store');
		expect(wrapper.text()).toContain('Canonical byte store');
		expect(wrapper.text()).toContain('Unavailable');
		expect(wrapper.text()).toContain('Healthy');

		await wrapper.findAll('button').find(button => button.text() === 'Refresh')!.trigger('click');
		expect(mockRefresh).toHaveBeenCalledOnce();
	});

	it('shows capacity categories and lets an administrator change both limits', async () => {
		mockApiFetch.mockResolvedValue({
			...capacity.value,
			canonical: {
				...capacity.value.canonical,
				limitBytes: 120 * 1024 * 1024 * 1024,
			},
			staging: {
				...capacity.value.staging,
				limitBytes: 12 * 1024 * 1024 * 1024,
			},
		});
		const wrapper = await mountPage();

		expect(wrapper.text()).toContain('Canonical quota');
		expect(wrapper.text()).toContain('100.0 GiB');
		expect(wrapper.text()).toContain('Staging allowance');
		expect(wrapper.text()).toContain('10.0 GiB');
		expect(wrapper.text()).toContain('Source content');
		expect(wrapper.text()).toContain('Derivatives');

		const inputs = wrapper.findAll('input');
		await inputs[0]!.setValue(120);
		await inputs[1]!.setValue(12);
		await wrapper.findAll('button')
			.find(button => button.text() === 'Save capacity limits')!
			.trigger('click');

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/admin/graphics-assets/capacity',
			{
				method: 'PUT',
				body: {
					canonicalLimitBytes: 120 * 1024 * 1024 * 1024,
					stagingLimitBytes: 12 * 1024 * 1024 * 1024,
				},
			},
		);
	});
});
