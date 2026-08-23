import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { GRAPHICS_AUTHOR_SIGNED_OUT_MESSAGE } from '~/composables/useGraphicsAuthorship';

const { mockLoad, mockNavigateTo, mockRoute } = vi.hoisted(() => ({
	mockLoad: vi.fn(),
	mockNavigateTo: vi.fn(),
	mockRoute: { fullPath: '/graphics-assets' },
}));

vi.mock('~/modules/auth/session', () => ({
	useAuthSession: () => ({ load: mockLoad }),
}));

mockNuxtImport('navigateTo', () => mockNavigateTo);
mockNuxtImport('useRoute', () => () => mockRoute);

const mockRead = vi.fn<() => Promise<string[]>>();

function mountReading(options: { unavailable?: string; inspectFailure?: (caught: unknown) => void } = {}) {
	let reading!: ReturnType<typeof useReusableLibraryReading<string>>;
	const wrapper = mount(defineComponent({
		setup() {
			reading = useReusableLibraryReading<string>({
				read: mockRead,
				unavailable: options.unavailable ?? 'The library could not be read.',
				inspectFailure: options.inspectFailure,
			});
			return () => h('div');
		},
	}));

	return { wrapper, reading };
}

describe('useReusableLibraryReading', () => {
	beforeEach(() => {
		mockRead.mockReset();
	});

	it('reads the library on mount', async () => {
		mockRead.mockResolvedValue(['first', 'second']);

		const { reading } = mountReading();
		await flushPromises();

		expect(mockRead).toHaveBeenCalledTimes(1);
		expect(reading.entries.value).toEqual(['first', 'second']);
		expect(reading.loading.value).toBe(false);
		expect(reading.error.value).toBeNull();
	});

	it('quotes the sentence the library wrote about a refused read', async () => {
		mockRead.mockRejectedValue(transportFailure({
			status: 409,
			body: { message: 'The library has moved on.' },
		}));

		const { reading } = mountReading();
		await flushPromises();

		expect(reading.error.value).toBe('The library has moved on.');
		expect(reading.signedOut.value).toBe(false);
	});

	it('falls back to the unavailable line when the failure carries no message', async () => {
		mockRead.mockRejectedValue({ some: 'object' });

		const { reading } = mountReading({ unavailable: 'The Style Set library could not be read.' });
		await flushPromises();

		expect(reading.error.value).toBe('The Style Set library could not be read.');
	});

	it('recognises an ended session and marks the reading signed out', async () => {
		mockRead.mockRejectedValue(transportFailure({
			status: 401,
			body: { message: 'Authentication is required' },
		}));

		const { reading } = mountReading();
		await flushPromises();

		expect(reading.error.value).toBe(GRAPHICS_AUTHOR_SIGNED_OUT_MESSAGE);
		expect(reading.signedOut.value).toBe(true);
	});

	it('lets a caller inspect the caught value before the message is derived', async () => {
		const caught = transportFailure({ status: 422, body: { message: 'Cannot be published.' } });
		mockRead.mockRejectedValue(caught);
		const inspectFailure = vi.fn();

		mountReading({ inspectFailure });
		await flushPromises();

		expect(inspectFailure).toHaveBeenCalledWith(caught);
	});

	it('keeps the refusal message through the re-read that follows a refused write', async () => {
		mockRead
			.mockRejectedValueOnce(transportFailure({ status: 409, body: { message: 'Write refused.' } }))
			.mockResolvedValue(['fresh']);

		const { reading } = mountReading();
		await flushPromises();

		expect(reading.error.value).toBe('Write refused.');

		await reading.refresh(true);

		expect(reading.entries.value).toEqual(['fresh']);
		expect(reading.error.value).toBe('Write refused.');

		await reading.refresh();

		expect(reading.error.value).toBeNull();
	});

	it('keeps the previous entries when a refresh fails', async () => {
		mockRead
			.mockResolvedValueOnce(['kept'])
			.mockRejectedValueOnce(transportFailure({ status: 409, body: { message: 'Later refusal.' } }));

		const { reading } = mountReading();
		await flushPromises();

		await reading.refresh();

		expect(reading.entries.value).toEqual(['kept']);
		expect(reading.error.value).toBe('Later refusal.');
	});
});
