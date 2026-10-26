import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { createMockEvent, createMockTalent } from '~~/test/helpers/fixtures';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { realtimeHandlersFor } from '~~/test/nuxt/helpers/realtimeEventSession';

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

const mockFeatureMatchStateStore = {
	updateAllClockSettings: vi.fn(),
	$reset: vi.fn(),
};

mockNuxtImport('useEventRepository', () => () => mockEventRepo);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useFeatureMatchAssignmentStore', () => () => ({
	$reset: vi.fn(),
}));
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);

const { deliver } = realtimeHandlersFor();

// EventResponse shape: DbEvent plus talents and meleeConfigured.
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
	});

	describe('loadEvent', () => {
		it('holds the Event until a reset', async () => {
			const event = createEventResponse({ id: 1 });
			mockEventRepo.getById.mockResolvedValue(event);

			await store.loadEvent(1);

			expect(store.event).toEqual(event);
			expect(store.eventId).toBe(1);

			store.$reset();

			expect(store.event).toBeNull();
		});

		it('does not repopulate an Event after the store is reset', async () => {
			const load = deferred<ReturnType<typeof createEventResponse>>();
			mockEventRepo.getById.mockReturnValue(load.promise);

			const loading = store.loadEvent(1);
			store.$reset();
			load.resolve(createEventResponse({ id: 1 }));
			await loading;

			expect(store.event).toBeNull();
		});

		it('reports a refused load and re-raises the failure it caught, not a narrowed copy', async () => {
			const refused = transportFailure({
				status: 403,
				body: { message: 'This Event belongs to another installation' },
			});
			mockEventRepo.getById.mockRejectedValue(refused);

			await expect(store.loadEvent(1)).rejects.toBe(refused);
			expect(store.error).toBe('This Event belongs to another installation');
		});
	});

	it('a created Event is listed and becomes the current Event', async () => {
		const created = createEventResponse({ id: 5, name: 'New Event' });
		mockEventRepo.create.mockResolvedValue(created);

		await store.createEvent({ name: 'New Event', game: 'mtg', featureMatchOrientation: 'horizontal' });

		expect(store.event).toEqual(created);
		expect(store.eventsList).toContainEqual(created);
	});

	describe('updateEvent', () => {
		it('holds the server\'s Event, in the current Event and its entry in the Events list', async () => {
			const original = createEventResponse({ id: 1, name: 'Original' });
			const other = createEventResponse({ id: 2, name: 'Other' });
			store.event = original;
			store.eventsList = [original, other];
			mockEventRepo.update.mockResolvedValue({ ...original, name: 'Server Updated' });

			await store.updateEvent({ name: 'Updated' });

			expect(store.event!.name).toBe('Server Updated');
			expect(store.eventsList.map(event => event.name)).toEqual(['Server Updated', 'Other']);
		});

		it('reports the server\'s sentence for a refused update and rolls the Event back', async () => {
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

		it('reloads the Feature Match Slots when their number changes', async () => {
			const original = createEventResponse({ id: 1, numFeatureMatches: 1 });
			store.event = original;
			mockEventRepo.update.mockResolvedValue({ ...original, numFeatureMatches: 3 });

			await store.updateEvent({ numFeatureMatches: 3 });

			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
		});

		it.each([
			[
				'clock type',
				{ featureMatchDefaultClockType: 'countdown' },
				['countdown', undefined, undefined],
			],
			[
				'clock duration, in minutes, as milliseconds',
				{ featureMatchDefaultClockDuration: 50 },
				[undefined, 50 * 60 * 1000, undefined],
			],
		])('pushes a changed default %s to every Feature Match clock', async (_, input, args) => {
			const original = createEventResponse({ id: 1 });
			store.event = original;
			mockEventRepo.update.mockResolvedValue(original);

			await store.updateEvent(input as never);

			expect(mockFeatureMatchStateStore.updateAllClockSettings).toHaveBeenCalledWith(...args);
		});
	});

	it('a deleted current Event is unlisted and cleared', async () => {
		const event = createEventResponse({ id: 1 });
		store.event = event;
		store.eventsList = [event];
		mockEventRepo.remove.mockResolvedValue({ success: true });

		await store.deleteEvent(1);

		expect(store.event).toBeNull();
		expect(store.eventsList).toEqual([]);
	});

	describe('talent writes', () => {
		it('add once, update and remove the current Event\'s Talent', async () => {
			store.event = createEventResponse({ id: 1, talents: [] });
			const talent = createMockTalent({ id: 10, eventId: 1, name: 'Ana' });
			mockTalentRepo.create.mockResolvedValue(talent);
			mockTalentRepo.update.mockResolvedValue({ ...talent, name: 'Ana renamed' });
			mockTalentRepo.remove.mockResolvedValue({ success: true });

			await store.addTalent({ name: 'Ana' });
			await store.addTalent({ name: 'Ana' });

			expect(store.event!.talents).toEqual([talent]);

			await store.updateTalent(10, { name: 'Ana renamed' });

			expect(store.event!.talents[0]!.name).toBe('Ana renamed');

			await store.removeTalent(10);

			expect(store.event!.talents).toEqual([]);
		});

		it.each([
			[
				'add',
				(s: ReturnType<typeof useEventStore>) => s.addTalent({ name: 'Test' }),
			],
			[
				'update',
				(s: ReturnType<typeof useEventStore>) => s.updateTalent(1, { name: 'Test' }),
			],
			[
				'remove',
				(s: ReturnType<typeof useEventStore>) => s.removeTalent(1),
			],
		])('a Talent %s with no Event loaded reports so and does nothing', async (_, write) => {
			await expect(write(store)).resolves.toBeNull();
			expect(store.error).toBe('No event loaded');
		});

		it('removing a Talent the Event does not hold reports so', async () => {
			store.event = createEventResponse({ id: 1, talents: [] });

			await expect(store.removeTalent(999)).resolves.toBeNull();
			expect(store.error).toBe('Talent not found');
		});
	});

	describe('a peer\'s Event and Talent messages', () => {
		it('update the Event', () => {
			store.event = createEventResponse({ id: 1, name: 'Old' });
			store.eventsList = [store.event!];

			deliver('event:updated', {
				event: { id: 1, name: 'Remote Update' },
			} as never);

			expect(store.event!.name).toBe('Remote Update');
		});

		it('add, upsert, update and remove its Talent', () => {
			store.event = createEventResponse({ id: 1, talents: [] });
			const talent = createMockTalent({ id: 20, eventId: 1, name: 'Ana' });

			deliver('talent:created', { talent } as never);
			deliver('talent:updated', {
				talent: createMockTalent({ id: 21, eventId: 1, name: 'Ben' }),
			} as never);
			deliver('talent:updated', {
				talent: { ...talent, name: 'Ana renamed' },
			} as never);

			expect(store.event!.talents.map(t => t.name)).toEqual(['Ana renamed', 'Ben']);

			deliver('talent:deleted', { eventId: 1, talentId: 20 } as never);

			expect(store.event!.talents.map(t => t.name)).toEqual(['Ben']);
		});
	});

	// A write is answered for the Event it was made in; coming back to that Event is a new lifetime too (#606).
	describe('a mutation answered after the operator switched Events', () => {
		async function switchTo(event: ReturnType<typeof createEventResponse>) {
			store.$reset();
			mockEventRepo.getById.mockResolvedValueOnce(event);
			await store.loadEvent(event.id);
		}

		it('a late successful save of Event A leaves Event B and its ID alone', async () => {
			const eventA = createEventResponse({ id: 1, name: 'Event A' });
			const eventB = createEventResponse({ id: 2, name: 'Event B' });
			store.event = eventA;
			const save = deferred<ReturnType<typeof createEventResponse>>();
			mockEventRepo.update.mockReturnValueOnce(save.promise);

			const saving = store.updateEvent({ name: 'Event A renamed' });
			await switchTo(eventB);
			save.resolve({ ...eventA, name: 'Event A renamed' });
			await saving;

			expect(store.event).toEqual(eventB);
			expect(store.eventId).toBe(2);
		});

		it('a late successful save of Event A leaves Event A, loaded again since, alone', async () => {
			const eventA = createEventResponse({ id: 1, name: 'Event A', numFeatureMatches: 1 });
			const reloadedA = createEventResponse({ id: 1, name: 'Event A renamed elsewhere', numFeatureMatches: 4 });
			store.event = eventA;
			const save = deferred<ReturnType<typeof createEventResponse>>();
			mockEventRepo.update.mockReturnValueOnce(save.promise);

			const saving = store.updateEvent({ name: 'Event A renamed', numFeatureMatches: 2 });
			await switchTo(createEventResponse({ id: 2, name: 'Event B' }));
			await switchTo(reloadedA);
			save.resolve({ ...eventA, name: 'Event A renamed', numFeatureMatches: 2 });
			await saving;

			expect(store.event).toEqual(reloadedA);
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).not.toHaveBeenCalled();
		});

		it('a late successful save still brings Event A\'s entry in the Events list up to date', async () => {
			const eventA = createEventResponse({ id: 1, name: 'Event A' });
			const eventB = createEventResponse({ id: 2, name: 'Event B' });
			store.event = eventA;
			store.eventsList = [eventA, eventB];
			const save = deferred<ReturnType<typeof createEventResponse>>();
			mockEventRepo.update.mockReturnValueOnce(save.promise);

			const saving = store.updateEvent({ name: 'Event A renamed' });
			await switchTo(eventB);
			save.resolve({ ...eventA, name: 'Event A renamed' });
			await saving;

			expect(store.eventsList.map(event => event.name)).toEqual(['Event A renamed', 'Event B']);
		});

		it('a save whose dependents settle after the switch does not push its clock settings into Event B', async () => {
			store.event = createEventResponse({ id: 1 });
			const slotsReload = deferred<void>();
			mockFeatureMatchStore.loadFeatureMatchesByEventId.mockReturnValueOnce(slotsReload.promise);
			mockEventRepo.update.mockResolvedValueOnce(createEventResponse({ id: 1, numFeatureMatches: 2 }));

			const saving = store.updateEvent({ numFeatureMatches: 2, featureMatchDefaultClockType: 'countdown' });
			await vi.waitFor(() => expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalled());
			await switchTo(createEventResponse({ id: 2 }));
			slotsReload.resolve();
			await saving;

			expect(mockFeatureMatchStateStore.updateAllClockSettings).not.toHaveBeenCalled();
		});

		it.each([
			[
				'Event B',
				[2],
			],
			[
				'Event A, loaded again since',
				[2, 1],
			],
		])('a late failed save of Event A neither rolls back nor reports into %s', async (_, switches) => {
			const eventA = createEventResponse({ id: 1, name: 'Event A' });
			store.event = eventA;
			const save = deferred<never>();
			mockEventRepo.update.mockReturnValueOnce(save.promise);

			const saving = store.updateEvent({ name: 'Event A renamed' });
			let shown = eventA;
			for (const id of switches) {
				shown = createEventResponse({ id, name: `Event ${id} as loaded` });
				await switchTo(shown);
			}
			save.reject(transportFailure({
				status: 409,
				body: { message: 'Rounds have started' },
			}));
			await saving;

			expect(store.event).toEqual(shown);
			expect(store.error).toBeNull();
		});

		it('a late Event create lists the new Event without loading it over Event B', async () => {
			const eventB = createEventResponse({ id: 2, name: 'Event B' });
			const created = createEventResponse({ id: 5, name: 'New Event' });
			const create = deferred<typeof created>();
			mockEventRepo.create.mockReturnValueOnce(create.promise);

			const creating = store.createEvent({ name: 'New Event', game: 'mtg', featureMatchOrientation: 'horizontal' });
			await switchTo(eventB);
			create.resolve(created);

			await expect(creating).resolves.toEqual(created);
			expect(store.event).toEqual(eventB);
			expect(store.eventsList).toContainEqual(created);
		});

		it('a late Event create the Events list already loaded is listed once', async () => {
			const created = createEventResponse({ id: 5, name: 'New Event' });
			const create = deferred<typeof created>();
			mockEventRepo.create.mockReturnValueOnce(create.promise);

			const creating = store.createEvent({ name: 'New Event', game: 'mtg', featureMatchOrientation: 'horizontal' });
			await switchTo(createEventResponse({ id: 2, name: 'Event B' }));
			mockEventRepo.list.mockResolvedValueOnce([
				createEventResponse({ id: 2, name: 'Event B' }),
				created,
			]);
			await store.loadEventsList();
			create.resolve(created);
			await creating;

			expect(store.eventsList.map(event => event.id)).toEqual([2, 5]);
		});

		it('a delete answered after leaving and coming back to the deleted Event still clears it, because it is gone', async () => {
			const eventA = createEventResponse({ id: 1, name: 'Event A' });
			store.event = eventA;
			store.eventsList = [eventA];
			const remove = deferred<{ success: true }>();
			mockEventRepo.remove.mockReturnValueOnce(remove.promise);

			const deleting = store.deleteEvent(1);
			await switchTo(createEventResponse({ id: 2 }));
			await switchTo(createEventResponse({ id: 1, name: 'Event A as loaded again' }));
			remove.resolve({ success: true });
			await deleting;

			expect(store.event).toBeNull();
			expect(store.eventsList).toEqual([]);
		});

		describe.each([
			[
				'Event B',
				[2],
			],
			[
				'Event A, loaded again since',
				[2, 1],
			],
		])('talent writes answered in %s', (_, switches) => {
			const talent = createMockTalent({ id: 10, eventId: 1, name: 'Ana' });

			/** Ends on an Event, whichever it is, whose Talents are one other person. */
			async function switchAway() {
				let shown!: ReturnType<typeof createEventResponse>;
				for (const id of switches) {
					shown = createEventResponse({
						id,
						talents: [
							createMockTalent({ id: 20 + id, eventId: id, name: 'Other' }),
						],
					});
					await switchTo(shown);
				}
				return structuredClone(shown);
			}

			it('a late Talent create adds nobody', async () => {
				store.event = createEventResponse({ id: 1, talents: [] });
				const create = deferred<typeof talent>();
				mockTalentRepo.create.mockReturnValueOnce(create.promise);

				const adding = store.addTalent({ name: 'Ana' });
				const shown = await switchAway();
				create.resolve(talent);

				await expect(adding).resolves.toEqual(talent);
				expect(store.event).toEqual(shown);
			});

			it('a late Talent update changes nobody, whether it succeeds or fails', async () => {
				store.event = createEventResponse({
					id: 1,
					talents: [talent],
				});
				const succeeded = deferred<typeof talent>();
				const failed = deferred<never>();
				mockTalentRepo.update
					.mockReturnValueOnce(succeeded.promise)
					.mockReturnValueOnce(failed.promise);

				const renaming = store.updateTalent(10, { name: 'Ana renamed' });
				const renamingAgain = store.updateTalent(10, { name: 'Ana renamed again' });
				const shown = await switchAway();
				succeeded.resolve({ ...talent, name: 'Ana renamed' });
				failed.reject(new Error('Talent update refused'));
				await Promise.all([renaming, renamingAgain]);

				expect(store.event).toEqual(shown);
				expect(store.error).toBeNull();
			});

			it('a late failed Talent delete restores nobody', async () => {
				store.event = createEventResponse({
					id: 1,
					talents: [talent],
				});
				const remove = deferred<never>();
				mockTalentRepo.remove.mockReturnValueOnce(remove.promise);

				const removing = store.removeTalent(10);
				const shown = await switchAway();
				remove.reject(new Error('Talent delete refused'));
				await removing;

				expect(store.event).toEqual(shown);
				expect(store.error).toBeNull();
			});
		});
	});
});
