import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

const { mockRefresh } = vi.hoisted(() => ({
	mockRefresh: vi.fn(),
}));

mockNuxtImport('useFetch', () => () => ({
	data: ref({
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
	}),
	status: ref('success'),
	error: ref(null),
	refresh: mockRefresh,
}));

const passthroughStub = defineComponent({ template: '<div><slot name="actions" /><slot /></div>' });
const badgeStub = defineComponent({
	props: ['label'],
	template: '<span><slot />{{ label }}</span>',
});
const buttonStub = defineComponent({
	emits: ['click'],
	template: '<button @click="$emit(\'click\')"><slot />Refresh</button>',
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

		await wrapper.get('button').trigger('click');
		expect(mockRefresh).toHaveBeenCalledOnce();
	});
});
