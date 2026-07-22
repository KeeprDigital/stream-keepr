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
});
