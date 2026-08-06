import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEvent, createMockTalent } from '~~/test/helpers/fixtures';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';
import { transportFailure } from '~~/test/helpers/transportFailure';

// ── Mock Dependencies ──

const mockEventRepo = {
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
};

const mockTalentRepo = vi.hoisted(() => ({
	list: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
}));

vi.mock('~/modules/event-data/client', async importOriginal => ({
	...(await importOriginal<typeof import('~~/app/modules/event-data/client')>()),
	useEventDataResource: () => mockTalentRepo,
}));

const mockFeatureMatchStore = {
	loadFeatureMatchesByEventId: vi.fn(),
	$reset: vi.fn(),
};

const mockFeatureMatchAssignmentStore = {
	$reset: vi.fn(),
};

const mockFeatureMatchStateStore = {
	updateAllClockSettings: vi.fn(),
	$reset: vi.fn(),
};

const mockAbly = createMockRealtime();
const mockIsSelfOrigin = vi.fn(() => false);

// Capture ably callbacks when stores register them
const ablyCallbacks: Record<string, Record<string, (...args: unknown[]) => void>> = {};
mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
	ablyCallbacks[storeName] = callbacks;
});

mockNuxtImport('useEventRepository', () => () => mockEventRepo);
mockNuxtImport('useRealtime', () => () => mockAbly);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useFeatureMatchAssignmentStore', () => () => mockFeatureMatchAssignmentStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
/*
 * `useAsyncAction` is deliberately not mocked, for the reason #245's suite gives: it is
 * the seam every action here reports through, and the hand-written copy that stood in for
 * it re-raised what it caught where the real composable resolves to `null` — so no test
 * here could say what an operator is shown. The real composable is auto-imported, does no
 * I/O and starts no timers, and it calls the same `onError` rollback the copy existed to
 * support (#241, #263).
 */

// Helper: EventResponse shape (DbEvent + talents + meleeConfigured)
function createEventResponse(overrides?: Record<string, any>) {
	const base = createMockEvent(overrides as any);
	return {
		...base,
		talents: overrides?.talents ?? [],
		meleeConfigured: overrides?.meleeConfigured ?? false,
	} as any;
}

describe('useEventStore', () => {
	let store: ReturnType<typeof useEventStore>;

	beforeEach(() => {
		store = useEventStore();
		store.$reset();
		store.eventsList = [];
		vi.clearAllMocks();
		// Re-register the implementation after clearAllMocks
		mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
			ablyCallbacks[storeName] = callbacks;
		});
		ablyCallbacks.event = {
			'event:updated': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteUpdated(data as any),
			'talent:created': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteTalentCreated(data as any),
			'talent:updated': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteTalentUpdated(data as any),
			'talent:deleted': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteTalentDeleted(data as any),
		};
	});

	// ── Loading ──

	describe('loadEvent', () => {
		it('populates event state', async () => {
			const event = createEventResponse({ id: 1 });
			mockEventRepo.getById.mockResolvedValue(event);

			await store.loadEvent(1);

			expect(store.event).toEqual(event);
			expect(store.isLoaded).toBe(true);
			expect(mockAbly.setRoom).toHaveBeenCalledWith('event:1');
		});

		it('does not repopulate an Event after the store is reset', async () => {
			let resolveLoad!: (value: ReturnType<typeof createEventResponse>) => void;
			mockEventRepo.getById.mockReturnValue(new Promise((resolve) => {
				resolveLoad = resolve;
			}));

			const load = store.loadEvent(1);
			store.$reset();
			resolveLoad(createEventResponse({ id: 1 }));
			await load;

			expect(store.event).toBeNull();
		});
	});

	describe('loadEventsList', () => {
		it('populates eventsList state', async () => {
			const events = [
				createEventResponse({ id: 1 }),
				createEventResponse({ id: 2, name: 'Event 2' }),
			];
			mockEventRepo.list.mockResolvedValue(events);

			await store.loadEventsList();

			expect(store.eventsList).toEqual(events);
		});
	});

	// ── Create ──

	describe('createEvent', () => {
		it('adds event to list and sets current event', async () => {
			const created = createEventResponse({ id: 5, name: 'New Event' });
			mockEventRepo.create.mockResolvedValue(created);

			await store.createEvent({ name: 'New Event', game: 'mtg', featureMatchOrientation: 'horizontal' });

			expect(store.event).toEqual(created);
			expect(store.eventsList).toContainEqual(created);
		});
	});

	// ── Update (optimistic) ──

	describe('updateEvent', () => {
		it('optimistically updates then applies server response', async () => {
			const original = createEventResponse({ id: 1, name: 'Original' });
			store.event = original;
			store.eventsList = [original];

			const serverUpdated = { ...original, name: 'Server Updated' };
			mockEventRepo.update.mockResolvedValue(serverUpdated);

			await store.updateEvent({ name: 'Updated' });

			expect(store.event!.name).toBe('Server Updated');
		});

		it('reloads feature matches when numFeatureMatches changes', async () => {
			const original = createEventResponse({ id: 1, numFeatureMatches: 1 });
			store.event = original;
			store.eventsList = [original];

			const serverUpdated = { ...original, numFeatureMatches: 3 };
			mockEventRepo.update.mockResolvedValue(serverUpdated);

			await store.updateEvent({ numFeatureMatches: 3 });

			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
		});
	});

	// ── Delete ──

	describe('deleteEvent', () => {
		it('removes event from list and resets if current', async () => {
			const event = createEventResponse({ id: 1 });
			store.event = event;
			store.eventsList = [event];
			mockEventRepo.remove.mockResolvedValue({ success: true });

			await store.deleteEvent(1);

			expect(store.event).toBeNull();
			expect(store.eventsList).toHaveLength(0);
		});
	});

	// ── Failure reporting ──

	describe('failure reporting', () => {
		it('reports the sentence a refused update carries, and rolls the Event back', async () => {
			const original = createEventResponse({ id: 1, name: 'Original' });
			store.event = original;
			store.eventsList = [original];
			mockEventRepo.update.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'Rounds have started, so the Event format can no longer change' },
			}));

			await store.updateEvent({ name: 'Updated' });

			expect(store.error).toBe('Rounds have started, so the Event format can no longer change');
			expect(store.event!.name).toBe('Original');
		});

		it('reports the sentence a refused load carries, and still re-raises the failure itself', async () => {
			const refused = transportFailure({
				status: 403,
				body: { message: 'This Event belongs to another installation' },
				request: `[GET] "/api/events/1"`,
			});
			mockEventRepo.getById.mockRejectedValue(refused);

			// The load reports and re-raises, and what it re-raises is deliberately the
			// failure it caught rather than the sentence wrapped in a fresh `Error`: the
			// route middleware catches this, and a caller that has to branch on a status
			// must still be able to read one.
			await expect(store.loadEvent(1)).rejects.toBe(refused);
			expect(store.error).toBe('This Event belongs to another installation');
		});

		it('reports the transport line for a 5xx load, whose body message the server sanitized', async () => {
			mockEventRepo.list.mockRejectedValue(transportFailure({
				status: 500,
				body: { message: 'Internal Server Error' },
				request: `[GET] "/api/events"`,
			}));

			await expect(store.loadEventsList()).rejects.toThrow();

			expect(store.error).toBe('[GET] "/api/events": 500 Internal Server Error');
		});
	});

	// ── Talent CRUD ──

	describe('addTalent', () => {
		it('appends talent to event', async () => {
			store.event = createEventResponse({ id: 1, talents: [] });
			const talent = createMockTalent({ id: 10, eventId: 1 });
			mockTalentRepo.create.mockResolvedValue(talent);

			await store.addTalent({ name: 'New Talent' });

			expect(store.event!.talents).toContainEqual(talent);
		});

		it('returns null and sets error when no event is loaded', async () => {
			const result = await store.addTalent({ name: 'Test' });

			expect(result).toBeNull();
			expect(store.error).toBe('No event loaded');
		});

		it('skips adding talent when already present (no-duplicate guard)', async () => {
			const talent = createMockTalent({ id: 10, eventId: 1 });
			store.event = createEventResponse({ id: 1, talents: [talent] });
			mockTalentRepo.create.mockResolvedValue(talent);

			await store.addTalent({ name: talent.name });

			expect(store.event!.talents).toHaveLength(1);
		});
	});

	describe('updateTalent', () => {
		it('optimistically updates talent then applies server response', async () => {
			const talent = createMockTalent({ id: 10, eventId: 1 });
			store.event = createEventResponse({ id: 1, talents: [talent] });

			const updated = { ...talent, name: 'Updated Talent' };
			mockTalentRepo.update.mockResolvedValue(updated);

			await store.updateTalent(10, { name: 'Updated Talent' });

			expect(store.event!.talents[0]!.name).toBe('Updated Talent');
		});

		it('returns null and sets error when no event is loaded', async () => {
			const result = await store.updateTalent(1, { name: 'Test' });

			expect(result).toBeNull();
			expect(store.error).toBe('No event loaded');
		});
	});

	describe('removeTalent', () => {
		it('removes talent from event', async () => {
			const talent = createMockTalent({ id: 10, eventId: 1 });
			store.event = createEventResponse({ id: 1, talents: [talent] });
			mockTalentRepo.remove.mockResolvedValue({ success: true });

			await store.removeTalent(10);

			expect(store.event!.talents).toHaveLength(0);
		});

		it('returns null and sets error when no event is loaded', async () => {
			const result = await store.removeTalent(1);

			expect(result).toBeNull();
			expect(store.error).toBe('No event loaded');
		});

		it('returns null and sets error when talent not found', async () => {
			store.event = createEventResponse({ id: 1, talents: [] });

			const result = await store.removeTalent(999);

			expect(result).toBeNull();
			expect(store.error).toBe('Talent not found');
		});
	});

	// ── Realtime Handlers ──

	describe('realtime handlers', () => {
		describe('event:updated', () => {
			it('updates event from remote message', () => {
				store.event = createEventResponse({ id: 1, name: 'Old' });
				store.eventsList = [store.event!];

				ablyCallbacks.event!['event:updated']!({ event: { id: 1, name: 'Remote Update' } }, {});

				expect(store.event!.name).toBe('Remote Update');
			});

			it('skips when isSelfOrigin returns true', () => {
				store.event = createEventResponse({ id: 1, name: 'Old' });
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.event!['event:updated']!({ event: { id: 1, name: 'Remote Update' } }, {});

				expect(store.event!.name).toBe('Old');
			});
		});

		describe('talent:created', () => {
			it('adds talent from remote message', () => {
				store.event = createEventResponse({ id: 1, talents: [] });
				const talent = createMockTalent({ id: 20, eventId: 1 });

				ablyCallbacks.event!['talent:created']!({ talent }, {});

				expect(store.event!.talents).toHaveLength(1);
			});

			it('skips when isSelfOrigin returns true', () => {
				store.event = createEventResponse({ id: 1, talents: [] });
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.event!['talent:created']!({ talent: createMockTalent({ id: 20, eventId: 1 }) }, {});

				expect(store.event!.talents).toHaveLength(0);
			});
		});

		describe('talent:deleted', () => {
			it('removes talent from remote message', () => {
				const talent = createMockTalent({ id: 20, eventId: 1 });
				store.event = createEventResponse({ id: 1, talents: [talent] });

				ablyCallbacks.event!['talent:deleted']!({ eventId: 1, talentId: 20 }, {});

				expect(store.event!.talents).toHaveLength(0);
			});
		});

		describe('talent:updated', () => {
			it('updates existing talent from remote message', () => {
				const talent = createMockTalent({ id: 10, eventId: 1, name: 'Original' });
				store.event = createEventResponse({ id: 1, talents: [talent] });

				ablyCallbacks.event!['talent:updated']!({ talent: { ...talent, name: 'Remote Update' } }, {});

				expect(store.event!.talents[0]!.name).toBe('Remote Update');
			});

			it('adds talent if not already present (upsert)', () => {
				store.event = createEventResponse({ id: 1, talents: [] });
				const newTalent = createMockTalent({ id: 99, eventId: 1, name: 'New' });

				ablyCallbacks.event!['talent:updated']!({ talent: newTalent }, {});

				expect(store.event!.talents).toHaveLength(1);
			});

			it('skips when isSelfOrigin returns true', () => {
				const talent = createMockTalent({ id: 10, eventId: 1, name: 'Original' });
				store.event = createEventResponse({ id: 1, talents: [talent] });
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.event!['talent:updated']!({ talent: { ...talent, name: 'Remote' } }, {});

				expect(store.event!.talents[0]!.name).toBe('Original');
			});
		});
	});

	// ── $reset ──

	describe('$reset', () => {
		it('clears event state', () => {
			store.event = createEventResponse({ id: 1 });
			store.error = 'some error';

			store.$reset();

			expect(store.event).toBeNull();
			expect(store.error).toBeNull();
			expect(store.loading).toBe(false);
			expect(mockAbly.setRoom).toHaveBeenCalledWith(null);
		});
	});

	// ── eventId computed ──

	describe('eventId', () => {
		it('returns event.id when an event is loaded', () => {
			store.event = createEventResponse({ id: 7 });
			expect(store.eventId).toBe(7);
		});
	});

	// ── updateEvent: rollback + list update ──

	describe('updateEvent — rollback on API error', () => {
		it('updates matching item in eventsList', async () => {
			const original = createEventResponse({ id: 1, name: 'Original' });
			const other = createEventResponse({ id: 2, name: 'Other' });
			store.event = original;
			store.eventsList = [original, other];
			const serverUpdated = { ...original, name: 'Server Updated' };
			mockEventRepo.update.mockResolvedValue(serverUpdated);

			await store.updateEvent({ name: 'Updated' });

			expect(store.eventsList[0]!.name).toBe('Server Updated');
			expect(store.eventsList[1]!.name).toBe('Other');
		});
	});

	// ── syncEventDependents: clock settings ──

	describe('syncEventDependents', () => {
		it('calls updateAllClockSettings when clock settings change', async () => {
			const original = createEventResponse({ id: 1 });
			store.event = original;
			store.eventsList = [original];
			mockEventRepo.update.mockResolvedValue(original);

			await store.updateEvent({ featureMatchDefaultClockType: 'countdown' });

			expect(mockFeatureMatchStateStore.updateAllClockSettings).toHaveBeenCalledWith(
				'countdown',
				undefined,
				undefined,
			);
		});

		it('converts clock duration from minutes to ms', async () => {
			const original = createEventResponse({ id: 1 });
			store.event = original;
			store.eventsList = [original];
			mockEventRepo.update.mockResolvedValue(original);

			await store.updateEvent({ featureMatchDefaultClockDuration: 50 });

			expect(mockFeatureMatchStateStore.updateAllClockSettings).toHaveBeenCalledWith(
				undefined,
				50 * 60 * 1000,
				undefined,
			);
		});
	});
});
