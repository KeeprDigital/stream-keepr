import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockToast = { add: vi.fn() };

mockNuxtImport('useToast', () => () => mockToast);

describe('useRequestFeedback', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns successful data and shows a configured success toast', async () => {
		const loading = ref(false);
		const { runRequest } = useRequestFeedback();

		const result = await runRequest(async () => ({ id: 7 }), {
			loadingRef: loading,
			success: result => ({
				title: 'Saved',
				description: `Saved ${result.id}`,
				color: 'success',
			}),
		});

		expect(result).toEqual({ id: 7 });
		expect(loading.value).toBe(false);
		expect(mockToast.add).toHaveBeenCalledWith({
			title: 'Saved',
			description: 'Saved 7',
			color: 'success',
		});
	});

	it('normalizes thrown Error instances for error toasts and refs', async () => {
		const errorRef = ref<string | null>('previous');
		const { runRequest } = useRequestFeedback();

		const result = await runRequest(async () => {
			throw new Error('Plain failure');
		}, {
			errorRef,
			error: ({ message }) => ({
				title: 'Failed',
				description: message,
				color: 'error',
			}),
		});

		expect(result).toBeNull();
		expect(errorRef.value).toBe('Plain failure');
		expect(mockToast.add).toHaveBeenCalledWith({
			title: 'Failed',
			description: 'Plain failure',
			color: 'error',
		});
	});

	it('prefers $fetch response data messages over wrapper messages', async () => {
		const { runRequest } = useRequestFeedback();

		await runRequest(async () => {
			const error = new Error('[POST] failed') as Error & {
				data: { message: string };
				statusMessage: string;
			};
			error.data = { message: 'Server validation failed' };
			error.statusMessage = 'Bad Request';
			throw error;
		}, {
			error: ({ message }) => ({
				title: 'Failed',
				description: message,
				color: 'error',
			}),
		});

		expect(mockToast.add).toHaveBeenCalledWith({
			title: 'Failed',
			description: 'Server validation failed',
			color: 'error',
		});
	});

	it('treats success false responses as failures and uses their error message', async () => {
		const onFailure = vi.fn();
		const { runRequest } = useRequestFeedback();

		const result = await runRequest(async () => ({
			success: false,
			error: 'Sync failed',
		}), {
			onFailure,
			error: ({ message }) => ({
				title: 'Sync Failed',
				description: message,
				color: 'error',
			}),
		});

		expect(result).toBeNull();
		expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
			message: 'Sync failed',
			result: { success: false, error: 'Sync failed' },
		}));
		expect(mockToast.add).toHaveBeenCalledWith({
			title: 'Sync Failed',
			description: 'Sync failed',
			color: 'error',
		});
	});

	it('treats null results as failures by default', async () => {
		const errorRef = ref<string | null>(null);
		const { runRequest } = useRequestFeedback();

		const result = await runRequest(async () => null, {
			errorRef,
			error: ({ message }) => ({
				title: 'Failed',
				description: message,
				color: 'error',
			}),
		});

		expect(result).toBeNull();
		expect(errorRef.value).toBe('Request failed');
		expect(mockToast.add).toHaveBeenCalledWith({
			title: 'Failed',
			description: 'Request failed',
			color: 'error',
		});
	});

	it('only applies callbacks and loading state from the latest keyed request', async () => {
		let resolveFirst!: (value: string) => void;
		const firstResult = new Promise<string>((resolve) => {
			resolveFirst = resolve;
		});
		const loading = ref(false);
		const onSuccess = vi.fn();
		const { runRequest } = useRequestFeedback();

		const first = runRequest(() => firstResult, {
			latestKey: 'metagame',
			loadingRef: loading,
			success: false,
			onSuccess,
		});
		const second = runRequest(async () => 'new', {
			latestKey: 'metagame',
			loadingRef: loading,
			success: false,
			onSuccess,
		});

		await second;
		resolveFirst('old');
		await first;

		expect(onSuccess).toHaveBeenCalledOnce();
		expect(onSuccess).toHaveBeenCalledWith('new');
		expect(loading.value).toBe(false);
	});
});
