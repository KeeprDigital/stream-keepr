import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockScreen } from '~~/test/helpers/fixtures';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';
import { transportFailure } from '~~/test/helpers/transportFailure';

/*
 * `useAsyncAction` is deliberately not mocked here, unlike in this store's other two
 * suites. It is the seam every write reports through, and what these tests are about
 * is the prose that comes out of it — a hand-written stand-in that ignores `errorRef`
 * can assert nothing about what an operator is shown. The real composable is
 * auto-imported, does no I/O and starts no timers (#241, #245).
 */

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

const mockAbly = createMockRealtime();

mockNuxtImport('useScreenRepository', () => () => mockRepo);
mockNuxtImport('useRealtime', () => () => mockAbly);

/**
 * The request line a failure below carries unless the row names another, since the list
 * route is what most of them exercise. It is asserted on by the two rows that read a
 * status line rather than a sentence, so it is a constant passed explicitly rather than
 * a parameter default on the fixture.
 *
 * The fixture itself is `test/helpers/transportFailure`, of which this suite held the
 * third hand copy until #288 (#262 lifted it, #263 took the second).
 */
const LIST_REQUEST = `[GET] "/api/events/1/screens"`;

/** A refusal the authority explained in the response body, carrying no code. */
function explainedRefusal(status: number, statusText: string, message: string, request = LIST_REQUEST) {
	return transportFailure({
		status,
		statusText,
		body: { statusCode: status, statusMessage: statusText, message },
		request,
	});
}

/**
 * What the operator is shown when a Screen request is refused.
 *
 * Everything this store reports ends at an `Error.message`, and for a `$fetch`
 * failure that message is the transport's status line — `[GET] "…": 409 Conflict` —
 * which names neither what was refused nor what to do about it. The sentence the
 * server wrote about the show is in the response body, and since #245 the
 * live-session store reads it; this is the same adoption for the Screen store, whose
 * `error` is what the Screens page puts in front of an operator (#262).
 *
 * The boundary is `failureSentence`'s and is documented there: a sub-500 status is
 * the authority answering this request, a 5xx is the server failing and its prose has
 * been rewritten to a placeholder on the way out, and a failure with no status never
 * reached the server at all.
 */
describe('useScreenStore error reporting', () => {
	let store: ReturnType<typeof useScreenStore>;

	beforeEach(() => {
		store = useScreenStore();
		store.$reset();
		// Reset rather than clear: these rows differ in the failure each route answers
		// with, and `clearAllMocks` leaves a previous row's rejection installed — which
		// is how the conflict-retry's refresh once picked up an unrelated 404.
		vi.resetAllMocks();
	});

	it('reports the list route’s sentence rather than its status line', async () => {
		mockRepo.list.mockRejectedValue(explainedRefusal(403, 'Forbidden', 'This Event has been archived'));

		await store.loadScreensByEventId(1);

		expect(store.error).toBe('This Event has been archived');
	});

	it('reports the slug route’s sentence rather than its status line', async () => {
		mockRepo.getBySlug.mockRejectedValue(explainedRefusal(
			409,
			'Conflict',
			'This Screen has been retired',
			`[GET] "/api/events/1/screens/by-slug/main"`,
		));

		await expect(store.loadScreenBySlug(1, 'main')).rejects.toThrow();

		expect(store.error).toBe('This Screen has been retired');
	});

	it('reports the single-Screen route’s sentence rather than its status line', async () => {
		mockRepo.getById.mockRejectedValue(explainedRefusal(
			404,
			'Not Found',
			'That Screen no longer belongs to this Event',
			`[GET] "/api/events/1/screens/5"`,
		));

		await store.getScreenById(1, 5);

		expect(store.error).toBe('That Screen no longer belongs to this Event');
	});

	it('reports a refused create in the words the authority used', async () => {
		// The writes report through the Module, which is handed the same reporting
		// wrapper the store's own actions use — one seam, not two that can drift.
		mockRepo.create.mockRejectedValue(explainedRefusal(
			409,
			'Conflict',
			'A Screen with that slug already exists',
			`[POST] "/api/events/1/screens"`,
		));

		await store.createScreen(1, { name: 'Screen', slug: 'main', currentMode: 'idle' });

		expect(store.error).toBe('A Screen with that slug already exists');
	});

	it('reports a refused delete in the words the authority used, and puts the Screen back', async () => {
		// The rollback runs off the substituted failure exactly as it ran off the raw
		// one: what the wrapper changes is the prose, not whether the action failed.
		store.screens = [createMockScreen({ id: 5, name: 'Main' })];
		mockRepo.remove.mockRejectedValue(explainedRefusal(
			409,
			'Conflict',
			'This Screen is on air and cannot be deleted',
			`[DELETE] "/api/events/1/screens/5"`,
		));

		await store.removeScreen(1, 5);

		expect(store.error).toBe('This Screen is on air and cannot be deleted');
		expect(store.screens.map(s => s.id)).toEqual([5]);
	});

	it('carries the sentence to a debounced write’s own caller, not only to the banner', async () => {
		// A config write answers its caller by rejecting a promise of its own, and the
		// editing surface reads that rejection for the message it shows beside the
		// field. Substituting the failure inside the action is what puts the sentence
		// on both paths.
		vi.useFakeTimers();
		store.screens = [createMockScreen({ id: 5, stateVersion: 1 })];
		// Deliberately not a 409: that status is the conflict-retry's own signal, and
		// what this row is about is the reporting seam, not the retry.
		mockRepo.updateScreenConfig.mockRejectedValue(explainedRefusal(
			403,
			'Forbidden',
			'This Event has been archived',
			`[PATCH] "/api/events/1/screens/5/config"`,
		));

		const write = store.updateScreenConfig(1, 5, { width: 1920 });
		const settled = expect(write).rejects.toThrow('This Event has been archived');
		await vi.advanceTimersByTimeAsync(300);
		await settled;

		expect(store.error).toBe('This Event has been archived');
		vi.useRealTimers();
	});

	it('leaves the conflict retry able to recognise the conflict it retries', async () => {
		// Where the substitution sits is load-bearing, and true by construction is not
		// pinned: it wraps the whole action, so `withConflictRetry` — nested further in —
		// still meets the raw FetchError and can read its 409. Substitute one level
		// deeper and `isConflictError` sees an Error carrying no status, the refresh and
		// the retry never run, and a write that should have settled reports a sentence
		// instead. The existing conflict fixtures cannot see that: their failures carry
		// no body sentence, so nothing about them changes when the substitution moves.
		store.screens = [createMockScreen({ id: 5, name: 'Old', stateVersion: 1 })];
		mockRepo.update
			.mockRejectedValueOnce(explainedRefusal(
				409,
				'Conflict',
				'Another operator changed this Screen',
				`[PATCH] "/api/events/1/screens/5"`,
			))
			.mockResolvedValueOnce(createMockScreen({ id: 5, name: 'Renamed', stateVersion: 3 }));
		mockRepo.getById.mockResolvedValue(createMockScreen({ id: 5, name: 'Refreshed', stateVersion: 2 }));

		const updated = await store.updateScreen(1, 5, { name: 'Renamed' });

		expect(mockRepo.update).toHaveBeenCalledTimes(2);
		// And the retry went out against the revision the refresh brought, not the one
		// the conflict was raised about.
		expect(mockRepo.update).toHaveBeenLastCalledWith(1, 5, expect.objectContaining({ stateVersion: 2 }));
		expect(updated!.name).toBe('Renamed');
		expect(store.error).toBeNull();
	});

	it('keeps the status line for a server failure, whose prose is a placeholder', async () => {
		// A 5xx body's message has been through `mapPublicNitroError`, so quoting it
		// would put 'Internal Server Error' in front of an operator dressed as the
		// authority's own words about the show.
		mockRepo.list.mockRejectedValue(explainedRefusal(500, 'Internal Server Error', 'Internal Server Error'));

		await store.loadScreensByEventId(1);

		expect(store.error).toBe(`${LIST_REQUEST}: 500 Internal Server Error`);
	});

	it('keeps the status line where the body carries no sentence to read', async () => {
		mockRepo.list.mockRejectedValue(transportFailure({
			status: 409,
			body: { statusCode: 409, statusMessage: 'Conflict' },
			request: LIST_REQUEST,
		}));

		await store.loadScreensByEventId(1);

		expect(store.error).toBe(`${LIST_REQUEST}: 409 Conflict`);
	});

	it('falls back to a static line where the throw was not an Error at all', async () => {
		// The one case on which the two spellings of this could have disagreed. #341
		// replaced a hand-written expansion of `reportedMessage`'s ordering with the
		// util itself, and the fallback is the branch that expansion reached last:
		// no sentence, and nothing carrying a message to show instead.
		mockRepo.list.mockRejectedValue('the repository threw a string');

		await store.loadScreensByEventId(1);

		expect(store.error).toBe('An error occurred');
	});

	it('keeps its own message for a failure that never reached the server', async () => {
		// No status means nothing about it was written by the authority, so none of it
		// may be quoted as though it were.
		mockRepo.list.mockRejectedValue(new Error('Failed to fetch'));

		await store.loadScreensByEventId(1);

		expect(store.error).toBe('Failed to fetch');
	});
});
