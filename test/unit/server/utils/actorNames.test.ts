import { describe, expect, it, vi } from 'vitest';

/**
 * What an administrator reading calls the identities it carries (#398, ADR-0010).
 *
 * Three kinds of actor share one column, and telling them apart is the whole of
 * this function: a **person** (a userId, named from the user table when the page
 * is read, so a rename reaches evidence written years ago), a **machine actor**
 * (`graphics-administrator`, `graphics-retention-policy` — spellings ADR-0010
 * keeps as they are), and an **anonymous-era author** (a Graphics Author Session
 * UUID from before the cutover, which resolves to nobody because there never was
 * anybody).
 *
 * The last two are both "not in the user table", which is why the shapes are what
 * separates them and why that separation is pinned here rather than assumed.
 */

const mockWhere = vi.fn();

vi.mock('hub:db', () => ({
	db: {
		select: () => ({ from: () => ({ where: mockWhere }) }),
	},
	schema: { user: { id: 'id', name: 'name', email: 'email' } },
}));

vi.mock('drizzle-orm', () => ({ inArray: (_column: unknown, values: string[]) => values }));

const { ANONYMOUS_ERA_ACTOR_NAME, graphicsActorNames } = await import('~~/server/utils/actorNames');

/** The user table holding exactly these people. */
function directoryOf(...users: Array<{ id: string; name: string; email: string }>) {
	mockWhere.mockImplementation((asked: string[]) => users.filter(user => asked.includes(user.id)));
}

const ANONYMOUS_AUTHOR = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('the names an administrator reading shows for its actors', () => {
	it('names a person from the user table, so a rename reaches old evidence', async () => {
		directoryOf({ id: 'user-1', name: 'Marcus Angel', email: 'marcus@keepr.digital' });

		await expect(graphicsActorNames(['user-1'])).resolves.toEqual({ 'user-1': 'Marcus Angel' });
	});

	it('falls back to the address for an account with no name, rather than to nothing', async () => {
		// The bootstrap takes a name and an admin-created account may carry an empty
		// one; a blank label reads as a surface that failed rather than as a person.
		directoryOf({ id: 'user-1', name: '   ', email: 'marcus@keepr.digital' });

		await expect(graphicsActorNames(['user-1'])).resolves.toEqual({ 'user-1': 'marcus@keepr.digital' });
	});

	it('calls an unresolved Graphics Author Session the anonymous era', async () => {
		directoryOf();

		await expect(graphicsActorNames([ANONYMOUS_AUTHOR]))
			.resolves
			.toEqual({ [ANONYMOUS_AUTHOR]: ANONYMOUS_ERA_ACTOR_NAME });
	});

	it('keeps a machine actor\'s own spelling, which is what ADR-0010 says to do', async () => {
		// An admin-token action and a retention sweep are not people and never had a
		// name to lose; relabelling either 'anonymous era' would say the entry came
		// from before the cutover, which is a different and false claim.
		directoryOf();

		await expect(graphicsActorNames(['graphics-administrator', 'graphics-retention-policy']))
			.resolves
			.toEqual({
				'graphics-administrator': 'graphics-administrator',
				'graphics-retention-policy': 'graphics-retention-policy',
			});
	});

	it('names every actor it was asked about, so a caller looks up rather than falls back', async () => {
		directoryOf({ id: 'user-1', name: 'Marcus Angel', email: 'marcus@keepr.digital' });

		const names = await graphicsActorNames(['user-1', ANONYMOUS_AUTHOR, 'graphics-retention-policy']);

		expect(Object.keys(names).sort()).toEqual([ANONYMOUS_AUTHOR, 'graphics-retention-policy', 'user-1'].sort());
	});

	it('asks about each identity once, however many entries name it', async () => {
		// A ledger page is hundreds of entries and a sweep writes most of them, so
		// the common shape is one actor repeated: de-duplicating is what keeps a
		// page of 500 to a single bound read.
		directoryOf();

		await graphicsActorNames(['graphics-retention-policy', 'graphics-retention-policy']);

		expect(mockWhere).toHaveBeenCalledTimes(1);
		expect(mockWhere).toHaveBeenCalledWith(['graphics-retention-policy']);
	});

	it('reads nothing at all when the reading named nobody', async () => {
		mockWhere.mockClear();

		await expect(graphicsActorNames([])).resolves.toEqual({});
		expect(mockWhere).not.toHaveBeenCalled();
	});

	it('splits a long ledger page into reads D1 will accept', async () => {
		// D1 binds at most 100 parameters per statement and a page of the ledger is
		// bounded at 500 entries, so an un-chunked `inArray` would be a runtime
		// failure on exactly the busiest page.
		mockWhere.mockClear();
		mockWhere.mockReturnValue([]);

		await graphicsActorNames(Array.from({ length: 120 }, (_, index) => `user-${index}`));

		expect(mockWhere).toHaveBeenCalledTimes(3);
		for (const [asked] of mockWhere.mock.calls)
			expect((asked as string[]).length).toBeLessThanOrEqual(50);
	});
});
