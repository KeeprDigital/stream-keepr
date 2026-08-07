import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { transportFailure } from '~~/test/helpers/transportFailure';

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

/**
 * The failures each read can meet, settable per test.
 *
 * `useFetch` hands its `error` on as the failure the request produced, and this page
 * renders it — so a mock that could only ever be `null` left the page's only failure
 * state uncovered (#286).
 */
const healthError = ref<unknown>(null);
const capacityLoadError = ref<unknown>(null);

mockNuxtImport('$fetch', () => mockApiFetch);
mockNuxtImport('useFetch', () => (path: string) => ({
	data: path === '/api/admin/graphics-assets/capacity' ? capacity : health,
	status: ref('success'),
	error: path === '/api/admin/graphics-assets/capacity' ? capacityLoadError : healthError,
	refresh: path === '/api/admin/graphics-assets/capacity' ? mockCapacityRefresh : mockRefresh,
}));

const passthroughStub = defineComponent({ template: '<div><slot name="actions" /><slot /></div>' });
/**
 * `UAlert` says most of what it says through props rather than slots, and a stub that
 * renders only the slot drops the reported failure entirely — which is why this page's
 * error state read as covered while nothing could observe it (#286).
 */
const alertStub = defineComponent({
	props: ['title', 'description'],
	template: '<div>{{ title }} {{ description }}<slot /></div>',
});
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
	props: ['modelValue', 'type'],
	emits: ['update:modelValue'],
	template: `<input
		:value="modelValue"
		:type="type"
		@input="$emit(
			'update:modelValue',
			type === 'number' ? Number($event.target.value) : $event.target.value,
		)"
	>`,
});

async function mountPage() {
	const { default: HealthPage } = await import('../../../../../app/pages/admin/graphics-assets/health.vue');
	return mount(HealthPage, {
		global: {
			stubs: {
				NuxtLayout: passthroughStub,
				UAlert: alertStub,
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
	beforeEach(() => {
		healthError.value = null;
		capacityLoadError.value = null;
	});

	/**
	 * Both reads sit behind the installation's administrator token, so the failure this
	 * page meets most often is the 403 whose body says what is missing. It used to render
	 * the failure's own `message`, which on a `$fetch` failure is the transport's line —
	 * naming the route and not the token (#271, #286).
	 */
	it('says what the server refused the health read for, not which route it was', async () => {
		healthError.value = transportFailure({
			status: 403,
			body: { message: 'Graphics Administrator authorization is required' },
			request: `[GET] "/api/admin/graphics-assets/health"`,
		});
		const wrapper = await mountPage();

		const alert = wrapper.get('[data-testid="health-load-error"]');
		expect(alert.text()).toContain('Graphics Administrator authorization is required');
		expect(alert.text()).not.toContain('403 Forbidden');
	});

	it('relays the setting a preserved 503 says was never configured', async () => {
		capacityLoadError.value = transportFailure({
			status: 503,
			body: { message: 'NUXT_GRAPHICS_ADMIN_TOKEN is not configured' },
			request: `[GET] "/api/admin/graphics-assets/capacity"`,
		});
		const wrapper = await mountPage();

		expect(wrapper.get('[data-testid="capacity-load-error"]').text())
			.toContain('NUXT_GRAPHICS_ADMIN_TOKEN is not configured');
	});

	it('falls back to the status line when the sanitizer got to the 5xx first', async () => {
		healthError.value = transportFailure({
			status: 500,
			body: { message: 'Internal Server Error' },
			request: `[GET] "/api/admin/graphics-assets/health"`,
		});
		const wrapper = await mountPage();

		expect(wrapper.get('[data-testid="health-load-error"]').text())
			.toContain('[GET] "/api/admin/graphics-assets/health": 500 Internal Server Error');
	});

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

		expect(wrapper.text()).toContain('Canonical Graphics Quota');
		expect(wrapper.text()).toContain('100.0 GiB');
		expect(wrapper.text()).toContain('Graphics Staging Allowance');
		expect(wrapper.text()).toContain('10.0 GiB');
		expect(wrapper.text()).toContain('Source content');
		expect(wrapper.text()).toContain('Derivatives');
		expect(wrapper.text()).toContain('Metadata');
		expect(wrapper.text()).toContain('Provider cache');
		expect(wrapper.text()).toContain('Unreachable quarantine');

		const inputs = wrapper.findAll('input');
		await inputs[0]!.setValue(120);
		await inputs[1]!.setValue(12);
		await inputs[2]!.setValue('admin-token');
		await wrapper.findAll('button')
			.find(button => button.text() === 'Save capacity limits')!
			.trigger('click');

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/admin/graphics-assets/capacity',
			{
				method: 'PUT',
				headers: {
					'x-graphics-admin-token': 'admin-token',
				},
				body: {
					canonicalLimitBytes: 120 * 1024 * 1024 * 1024,
					stagingLimitBytes: 12 * 1024 * 1024 * 1024,
				},
			},
		);
	});
});
