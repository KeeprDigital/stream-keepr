import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { FetchError } from 'ofetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockScreen } from '~~/test/helpers/fixtures';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';

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

const LIST_REQUEST = `[GET] "/api/events/1/screens"`;

/**
 * One failed request as the repository actually rejects it.
 *
 * Every call this store makes goes through `$fetch`, so every failure it meets is a
 * `FetchError`: an `Error` whose own `message` is the transport's status line, with
 * the status on `statusCode` and the parsed response body on `data`. A plain object
 * is none of those three, and the difference is not cosmetic — `useAsyncAction`
 * reports a non-`Error` as 'An error occurred', so a suite rejecting with plain
 * objects can assert prose no operator will ever be shown (#241).
 */
function transportFailure(
	status: number,
	statusText: string,
	/** The parsed response body, as `$fetch` hangs it off `error.data`. */
	body?: unknown,
	request = LIST_REQUEST,
): FetchError {
	return Object.assign(new FetchError(`${request}: ${status} ${statusText}`), {
		status,
		statusCode: status,
		statusText,
		statusMessage: statusText,
		data: body,
	});
}

/** A refusal the authority explained in the response body, carrying no code. */
function explainedRefusal(status: number, statusText: string, message: string, request = LIST_REQUEST) {
	return transportFailure(status, statusText, { statusCode: status, statusMessage: statusText, message }, request);
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

	it('keeps the status line for a server failure, whose prose is a placeholder', async () => {
		// A 5xx body's message has been through `mapPublicNitroError`, so quoting it
		// would put 'Internal Server Error' in front of an operator dressed as the
		// authority's own words about the show.
		mockRepo.list.mockRejectedValue(explainedRefusal(500, 'Internal Server Error', 'Internal Server Error'));

		await store.loadScreensByEventId(1);

		expect(store.error).toBe(`${LIST_REQUEST}: 500 Internal Server Error`);
	});

	it('keeps the status line where the body carries no sentence to read', async () => {
		mockRepo.list.mockRejectedValue(transportFailure(409, 'Conflict', { statusCode: 409, statusMessage: 'Conflict' }));

		await store.loadScreensByEventId(1);

		expect(store.error).toBe(`${LIST_REQUEST}: 409 Conflict`);
	});

	it('keeps its own message for a failure that never reached the server', async () => {
		// No status means nothing about it was written by the authority, so none of it
		// may be quoted as though it were.
		mockRepo.list.mockRejectedValue(new Error('Failed to fetch'));

		await store.loadScreensByEventId(1);

		expect(store.error).toBe('Failed to fetch');
	});
});
