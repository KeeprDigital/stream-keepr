import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STATE_CONFLICT_CODE } from '~~/shared/utils/stateConflict';
import { createMockScreen } from '~~/test/helpers/fixtures';
import { transportFailure } from '~~/test/helpers/transportFailure';

const mockRepo = {
	list: vi.fn(),
	getById: vi.fn(),
	getBySlug: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	updateModeConfig: vi.fn(),
	updateScreenConfig: vi.fn(),
	remove: vi.fn(),
};

mockNuxtImport('useScreenRepository', () => () => mockRepo);

/** A refusal the authority explained in the response body, carrying no code. */
function explainedRefusal(status: number, message: string) {
	return transportFailure({
		status,
		body: { statusCode: status, message },
	});
}

/**
 * Every Screen request reports through one seam, so the Screens page shows the
 * authority's sentence; `failureSentence`'s own suite owns which failures carry one.
 */
describe('useScreenStore error reporting', () => {
	let store: ReturnType<typeof useScreenStore>;

	beforeEach(() => {
		store = useScreenStore();
		store.$reset();
		// Reset, not clear: a previous row's rejection must not leak into the next route.
		vi.resetAllMocks();
	});

	it.each([
		[
			'the list',
			'list',
			(s: ReturnType<typeof useScreenStore>) => s.loadScreensByEventId(1),
		],
		[
			'the slug read',
			'getBySlug',
			(s: ReturnType<typeof useScreenStore>) => s.loadScreenBySlug(1, 'main').catch(() => {}),
		],
		[
			'the single-Screen read',
			'getById',
			(s: ReturnType<typeof useScreenStore>) => s.getScreenById(1, 5),
		],
		[
			'a create',
			'create',
			(s: ReturnType<typeof useScreenStore>) => s.createScreen(1, { name: 'Screen', slug: 'main', currentMode: 'background' }),
		],
	] as const)('reports %s\'s refusal in the authority\'s words', async (_, method, request) => {
		mockRepo[method].mockRejectedValue(explainedRefusal(409, 'This Event has been archived'));

		await request(store);

		expect(store.error).toBe('This Event has been archived');
	});

	it('puts the Screen back when a delete is refused, and reports why', async () => {
		store.screens = [
			createMockScreen({ id: 5, name: 'Main' }),
		];
		mockRepo.remove.mockRejectedValue(explainedRefusal(409, 'This Screen is on air and cannot be deleted'));

		await store.removeScreen(1, 5);

		expect(store.error).toBe('This Screen is on air and cannot be deleted');
		expect(store.screens.map(s => s.id)).toEqual([5]);
	});

	// A debounced write answers its own caller, which shows the message beside the field, as well as the banner.
	it.each([
		[
			'Screen-config',
			(s: ReturnType<typeof useScreenStore>) => s.updateScreenConfig(1, 5, { width: 1920 }),
			'updateScreenConfig',
		],
		[
			'mode-config',
			(s: ReturnType<typeof useScreenStore>) => s.updateModeConfig(1, 5, 'card', { scale: 2 }),
			'updateModeConfig',
		],
	] as const)('carries a refused %s write\'s sentence to its caller and to the banner', async (_, write, method) => {
		vi.useFakeTimers();
		store.screens = [
			createMockScreen({ id: 5, stateVersion: 1 }),
		];
		// Not a 409, which is the conflict retry's own signal.
		mockRepo[method].mockRejectedValue(explainedRefusal(403, 'This Event has been archived'));

		const settled = expect(write(store)).rejects.toThrow('This Event has been archived');
		await vi.advanceTimersByTimeAsync(300);
		await settled;

		expect(store.error).toBe('This Event has been archived');
		vi.useRealTimers();
	});

	// The sentence substitution wraps the whole action, so the conflict retry inside it still meets the raw 409 (#381).
	it('leaves the conflict retry able to recognise the conflict it retries', async () => {
		store.screens = [
			createMockScreen({ id: 5, name: 'Old', stateVersion: 1 }),
		];
		mockRepo.update
			.mockRejectedValueOnce(transportFailure({
				status: 409,
				body: {
					statusCode: 409,
					message: 'Screen 5 state was modified concurrently',
					data: { code: STATE_CONFLICT_CODE },
				},
			}))
			.mockResolvedValueOnce(createMockScreen({ id: 5, name: 'Renamed', stateVersion: 3 }));
		mockRepo.getById.mockResolvedValue(createMockScreen({ id: 5, name: 'Refreshed', stateVersion: 2 }));

		const updated = await store.updateScreen(1, 5, { name: 'Renamed' });

		expect(mockRepo.update).toHaveBeenCalledTimes(2);
		expect(mockRepo.update).toHaveBeenLastCalledWith(1, 5, expect.objectContaining({ stateVersion: 2 }));
		expect(updated!.name).toBe('Renamed');
		expect(store.error).toBeNull();
	});
});
