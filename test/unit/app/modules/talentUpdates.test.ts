import { describe, expect, it, vi } from 'vitest';
import { applyTalentUpdates } from '~~/app/modules/event-data/talentUpdates';

function mutations() {
	return {
		removeTalent: vi.fn().mockResolvedValue({ success: true }),
		addTalent: vi.fn().mockResolvedValue({ id: 99, name: 'Added' }),
		updateTalent: vi.fn().mockImplementation((id: number, input: { name: string }) =>
			Promise.resolve({ id, name: input.name })),
	};
}

describe('applyTalentUpdates', () => {
	it('stops and rejects when a mutation returns null', async () => {
		const calls = mutations();
		calls.removeTalent.mockResolvedValue(null);

		await expect(applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Alice' }],
			requestedTalents: [{ name: 'Bob' }],
			...calls,
		})).rejects.toThrow('Failed to remove Alice');

		expect(calls.addTalent).not.toHaveBeenCalled();
	});

	// A talent the operator renamed is the same person, and the event points at
	// them by id. Replacing the row hands the same name a new id, and the old id
	// is what `commentator1_talent_id` holds — an `onDelete: 'set null'` away from
	// being cleared without a word.
	it('renames a talent in place rather than replacing them', async () => {
		const calls = mutations();

		await applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Bob' }],
			requestedTalents: [{ id: 1, name: 'Robert' }],
			...calls,
		});

		expect(calls.updateTalent).toHaveBeenCalledTimes(1);
		expect(calls.updateTalent).toHaveBeenCalledWith(1, { name: 'Robert', socialProfiles: {} });
		expect(calls.removeTalent).not.toHaveBeenCalled();
		expect(calls.addTalent).not.toHaveBeenCalled();
	});

	it('rejects when a rename fails, before it touches anything else', async () => {
		const calls = mutations();
		calls.updateTalent.mockResolvedValue(null);

		await expect(applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Bob' }, { id: 2, name: 'Dana' }],
			requestedTalents: [{ id: 1, name: 'Robert' }],
			...calls,
		})).rejects.toThrow('Failed to update Bob');

		expect(calls.removeTalent).not.toHaveBeenCalled();
		expect(calls.addTalent).not.toHaveBeenCalled();
	});

	// The defect this whole contract change exists for: two talents sharing a name
	// are one row each, and only their ids tell them apart.
	it('removes exactly the namesake the operator dropped', async () => {
		const calls = mutations();

		await applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Bob' }, { id: 2, name: 'Bob' }],
			requestedTalents: [{ id: 1, name: 'Bob' }],
			...calls,
		});

		expect(calls.removeTalent).toHaveBeenCalledTimes(1);
		expect(calls.removeTalent).toHaveBeenCalledWith(2);
		expect(calls.addTalent).not.toHaveBeenCalled();
		expect(calls.updateTalent).not.toHaveBeenCalled();
	});

	it('removes the first namesake just as readily as the second', async () => {
		const calls = mutations();

		await applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Bob' }, { id: 2, name: 'Bob' }],
			requestedTalents: [{ id: 2, name: 'Bob' }],
			...calls,
		});

		expect(calls.removeTalent).toHaveBeenCalledTimes(1);
		expect(calls.removeTalent).toHaveBeenCalledWith(1);
	});

	it('keeps both namesakes when neither was dropped', async () => {
		const calls = mutations();

		await applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Bob' }, { id: 2, name: 'Bob' }],
			requestedTalents: [{ id: 1, name: 'Bob' }, { id: 2, name: 'Bob' }],
			...calls,
		});

		expect(calls.removeTalent).not.toHaveBeenCalled();
		expect(calls.addTalent).not.toHaveBeenCalled();
		expect(calls.updateTalent).not.toHaveBeenCalled();
	});

	it('adds an entry that carries no id, namesake or not', async () => {
		const calls = mutations();

		await applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Bob' }],
			requestedTalents: [{ id: 1, name: 'Bob' }, { name: 'Bob' }, { name: 'Dana' }],
			...calls,
		});

		expect(calls.addTalent).toHaveBeenCalledTimes(2);
		expect(calls.addTalent).toHaveBeenCalledWith({ name: 'Bob', socialProfiles: {} });
		expect(calls.addTalent).toHaveBeenCalledWith({ name: 'Dana', socialProfiles: {} });
		expect(calls.removeTalent).not.toHaveBeenCalled();
	});

	it('settles a rename, a removal and an addition in one save', async () => {
		const calls = mutations();

		await applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }, { id: 3, name: 'Caspar' }],
			requestedTalents: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Robert' }, { name: 'Dana' }],
			...calls,
		});

		expect(calls.updateTalent).toHaveBeenCalledTimes(1);
		expect(calls.updateTalent).toHaveBeenCalledWith(2, { name: 'Robert', socialProfiles: {} });
		expect(calls.removeTalent).toHaveBeenCalledTimes(1);
		expect(calls.removeTalent).toHaveBeenCalledWith(3);
		expect(calls.addTalent).toHaveBeenCalledTimes(1);
		expect(calls.addTalent).toHaveBeenCalledWith({ name: 'Dana', socialProfiles: {} });
	});

	// The list the operator saved is the list they want the event to have. If a
	// concurrent delete landed under an unsaved edit, the row is still on their
	// screen and re-creating it is the reading that keeps what they can see.
	it('re-creates an entry whose talent went away underneath it', async () => {
		const calls = mutations();

		await applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Alice' }],
			requestedTalents: [{ id: 1, name: 'Alice' }, { id: 7, name: 'Dana' }],
			...calls,
		});

		expect(calls.addTalent).toHaveBeenCalledTimes(1);
		expect(calls.addTalent).toHaveBeenCalledWith({ name: 'Dana', socialProfiles: {} });
		expect(calls.removeTalent).not.toHaveBeenCalled();
		expect(calls.updateTalent).not.toHaveBeenCalled();
	});

	it('does nothing at all when nothing changed', async () => {
		const calls = mutations();

		await applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
			requestedTalents: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
			...calls,
		});

		expect(calls.removeTalent).not.toHaveBeenCalled();
		expect(calls.addTalent).not.toHaveBeenCalled();
		expect(calls.updateTalent).not.toHaveBeenCalled();
	});

	it('updates a complete Social Profile set without replacing the Talent identity', async () => {
		const calls = mutations();

		await applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Alice', socialProfiles: { twitch: 'Old' } }],
			requestedTalents: [{ id: 1, name: 'Alice', socialProfiles: { youtube: 'New' } }],
			...calls,
		});

		expect(calls.updateTalent).toHaveBeenCalledOnce();
		expect(calls.updateTalent).toHaveBeenCalledWith(1, {
			name: 'Alice',
			socialProfiles: { youtube: 'New' },
		});
		expect(calls.removeTalent).not.toHaveBeenCalled();
		expect(calls.addTalent).not.toHaveBeenCalled();
	});
});
