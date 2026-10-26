import type {
	GraphicsAssetLibraryCapacity,
	GraphicsAssetLibraryHealth,
} from '~~/shared/types/graphicsAsset';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';

const { mockApiFetch } = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
}));

mockNuxtImport('$fetch', () => mockApiFetch);

const GIB = 1024 * 1024 * 1024;

const HEALTH_ROUTE = '/api/admin/graphics-assets/health';
const CAPACITY_ROUTE = '/api/admin/graphics-assets/capacity';

function libraryHealth(): GraphicsAssetLibraryHealth {
	return {
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
	} as GraphicsAssetLibraryHealth;
}

function libraryCapacity(): GraphicsAssetLibraryCapacity {
	return {
		canonical: {
			limitBytes: 100 * GIB,
			usedBytes: 75,
			reservedBytes: 5,
			availableBytes: 100 * GIB - 80,
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
			limitBytes: 10 * GIB,
			usedBytes: 20,
			reservedBytes: 10,
			availableBytes: 10 * GIB - 30,
		},
	} as GraphicsAssetLibraryCapacity;
}

/** Answers each route with its own payload, so no single body can make the page look right. */
function serve(options: {
	health?: GraphicsAssetLibraryHealth | Error;
	capacity?: GraphicsAssetLibraryCapacity | Error;
	saved?: GraphicsAssetLibraryCapacity;
} = {}) {
	const health = options.health ?? libraryHealth();
	const capacity = options.capacity ?? libraryCapacity();
	mockApiFetch.mockImplementation((url: string, init?: { method?: string }) => {
		if (url === HEALTH_ROUTE) {
			return health instanceof Error
				? Promise.reject(health)
				: Promise.resolve(health);
		}
		if (init?.method === 'PUT')
			return Promise.resolve(options.saved ?? capacity);
		return capacity instanceof Error
			? Promise.reject(capacity)
			: Promise.resolve(capacity);
	});
}

const passthroughStub = defineComponent({
	template: '<div><slot name="actions" /><slot /></div>',
});

async function mountPage() {
	const { default: HealthPage } = await import('../../../../../app/pages/admin/graphics-assets/health.vue');
	return mount(HealthPage, {
		global: {
			stubs: { ...nuxtUiStubs, NuxtLayout: passthroughStub },
		},
	});
}

/** Enters the administrator token and takes the first reading, as an administrator does. */
async function openHealth() {
	const wrapper = await mountPage();
	await wrapper.find('input').setValue('admin-token');
	await wrapper.findAll('button')
		.find(button => button.text() === 'Open health')!
		.trigger('click');
	await flushPromises();
	return wrapper;
}

describe('the Graphics Asset Library health page', () => {
	beforeEach(() => {
		mockApiFetch.mockReset();
		serve();
	});

	// Both reads are guarded by `requireGraphicsAdministrator`; without the token they are 403s.
	it('sends the administrator token with both of its reads', async () => {
		await openHealth();

		expect(mockApiFetch).toHaveBeenCalledWith(
			HEALTH_ROUTE,
			{
				headers: { 'x-graphics-admin-token': 'admin-token' },
			},
		);
		expect(mockApiFetch).toHaveBeenCalledWith(
			CAPACITY_ROUTE,
			{
				headers: { 'x-graphics-admin-token': 'admin-token' },
			},
		);
	});

	it('reads nothing until an administrator supplies a token', async () => {
		const wrapper = await mountPage();

		expect(mockApiFetch).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain('Graphics Administrator token');
	});

	it('says what the server refused the health read for, not which route it was', async () => {
		serve({
			health: transportFailure({
				status: 403,
				body: { message: 'Graphics Administrator authorization is required' },
				request: `[GET] "${HEALTH_ROUTE}"`,
			}),
		});
		const wrapper = await openHealth();

		const failure = wrapper.get('[data-testid="health-load-error"]');
		expect(failure.text()).toContain('Graphics Administrator authorization is required');
		expect(failure.text()).not.toContain('403 Forbidden');
	});

	it('shows catalogue, staging, and canonical health as separate administrator results', async () => {
		const wrapper = await openHealth();

		expect(wrapper.text()).toContain('Graphics Asset Library health');
		expect(wrapper.text()).toContain('D1 catalogue');
		expect(wrapper.text()).toContain('Staging byte store');
		expect(wrapper.text()).toContain('Canonical byte store');
		expect(wrapper.text()).toContain('Unavailable');
		expect(wrapper.text()).toContain('Healthy');

		mockApiFetch.mockClear();
		await wrapper.findAll('button').find(button => button.text() === 'Refresh')!.trigger('click');
		await flushPromises();

		expect(mockApiFetch).toHaveBeenCalledWith(
			HEALTH_ROUTE,
			{
				headers: { 'x-graphics-admin-token': 'admin-token' },
			},
		);
	});

	it('shows capacity categories and lets an administrator change both limits', async () => {
		serve({
			saved: {
				...libraryCapacity(),
				canonical: {
					...libraryCapacity().canonical,
					limitBytes: 120 * GIB,
				},
				staging: {
					...libraryCapacity().staging,
					limitBytes: 12 * GIB,
				},
			} as GraphicsAssetLibraryCapacity,
		});
		const wrapper = await openHealth();

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
		await wrapper.findAll('button')
			.find(button => button.text() === 'Save capacity limits')!
			.trigger('click');
		await flushPromises();

		// The token already held for this session is what authorises the write; the page
		// never asks for it a second time.
		expect(mockApiFetch).toHaveBeenCalledWith(
			CAPACITY_ROUTE,
			{
				method: 'PUT',
				headers: { 'x-graphics-admin-token': 'admin-token' },
				body: {
					canonicalLimitBytes: 120 * GIB,
					stagingLimitBytes: 12 * GIB,
				},
			},
		);
	});

	it('returns to the token form when the token stops being accepted', async () => {
		const wrapper = await openHealth();
		expect(wrapper.text()).toContain('D1 catalogue');

		// The token is rotated underneath a page that is already polling.
		serve({
			health: transportFailure({
				status: 403,
				body: { message: 'Graphics Administrator authorization is required' },
				request: `[GET] "${HEALTH_ROUTE}"`,
			}),
		});
		await wrapper.findAll('button').find(button => button.text() === 'Refresh')!.trigger('click');
		await flushPromises();

		// The stale reading is dropped rather than left on screen as a library state
		// nobody is still checking, and re-authorising is possible again.
		expect(wrapper.text()).not.toContain('D1 catalogue');
		expect(wrapper.text()).not.toContain('Canonical Graphics Quota');
		expect(wrapper.text()).toContain('Graphics Administrator token');
		expect(wrapper.findAll('button').some(button => button.text() === 'Open health')).toBe(true);
	});
});
