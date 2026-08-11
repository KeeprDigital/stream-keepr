import { describe, expect, it, vi } from 'vitest';
import { applyTalentUpdates } from '~~/app/modules/event-data/talentUpdates';

describe('applyTalentUpdates', () => {
	it('stops and rejects when a mutation returns null', async () => {
		const removeTalent = vi.fn().mockResolvedValue(null);
		const addTalent = vi.fn().mockResolvedValue({ id: 2, name: 'Bob' });

		await expect(applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Alice' }],
			requestedTalents: [{ name: 'Bob' }],
			removeTalent,
			addTalent,
		})).rejects.toThrow('Failed to remove Alice');

		expect(addTalent).not.toHaveBeenCalled();
	});

	// The requested list carries names and no ids, so two talents called "Bob" are
	// indistinguishable in it — only how many times the name appears says whether
	// one of them was dropped. Matching on set membership cannot see that, and a
	// removal that leaves a namesake behind reads to the operator as a save that
	// silently did nothing.
	it('removes the surplus namesake when a duplicate name is dropped', async () => {
		const removeTalent = vi.fn().mockResolvedValue({ success: true });
		const addTalent = vi.fn();

		await applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Bob' }, { id: 2, name: 'Bob' }],
			requestedTalents: [{ name: 'Bob' }],
			removeTalent,
			addTalent,
		});

		expect(removeTalent).toHaveBeenCalledTimes(1);
		expect(removeTalent).toHaveBeenCalledWith(2);
		expect(addTalent).not.toHaveBeenCalled();
	});

	it('keeps both namesakes when neither was dropped', async () => {
		const removeTalent = vi.fn();
		const addTalent = vi.fn();

		await applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Bob' }, { id: 2, name: 'Bob' }],
			requestedTalents: [{ name: 'Bob' }, { name: 'Bob' }],
			removeTalent,
			addTalent,
		});

		expect(removeTalent).not.toHaveBeenCalled();
		expect(addTalent).not.toHaveBeenCalled();
	});

	it('adds a second namesake when the operator asks for one', async () => {
		const removeTalent = vi.fn();
		const addTalent = vi.fn().mockResolvedValue({ id: 2, name: 'Bob' });

		await applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Bob' }],
			requestedTalents: [{ name: 'Bob' }, { name: 'Bob' }],
			removeTalent,
			addTalent,
		});

		expect(removeTalent).not.toHaveBeenCalled();
		expect(addTalent).toHaveBeenCalledTimes(1);
		expect(addTalent).toHaveBeenCalledWith({ name: 'Bob' });
	});

	it('leaves untouched names alone while it settles a duplicate', async () => {
		const removeTalent = vi.fn().mockResolvedValue({ success: true });
		const addTalent = vi.fn().mockResolvedValue({ id: 4, name: 'Dana' });

		await applyTalentUpdates({
			currentTalents: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }, { id: 3, name: 'Bob' }],
			requestedTalents: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Dana' }],
			removeTalent,
			addTalent,
		});

		expect(removeTalent).toHaveBeenCalledTimes(1);
		expect(removeTalent).toHaveBeenCalledWith(3);
		expect(addTalent).toHaveBeenCalledTimes(1);
		expect(addTalent).toHaveBeenCalledWith({ name: 'Dana' });
	});
});
