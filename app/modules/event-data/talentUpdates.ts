interface TalentSummary {
	id: number;
	name: string;
}

interface TalentUpdateOptions<T> {
	currentTalents: TalentSummary[];
	requestedTalents: Array<{ name: string }>;
	removeTalent: (talentId: number) => Promise<unknown>;
	addTalent: (input: { name: string }) => Promise<T | null>;
}

/**
 * Reconciles the Talents card's list against the event's, by **count** per name
 * rather than by set membership.
 *
 * The card emits names and no ids, so two talents called "Bob" are indistinguishable
 * in what it sends and only the number of times the name appears says whether one of
 * them was dropped. Membership cannot see that: asked to keep one Bob of two, it finds
 * a requested "Bob" matching each current Bob, removes neither, adds neither, and
 * reports success — after which the card resets from an event that never changed and
 * the row the operator deleted comes back. That is the whole of how a duplicate talent
 * became unremovable through the only screen that removes talents.
 *
 * Pairing each request with one existing talent leaves the surplus behind, and the
 * surplus is what gets removed. Pairing in list order means the namesake removed is
 * the **later** one, which is the one an accidental double-create just added.
 *
 * Matching stays case-sensitive: "bob" and "Bob" are two rows in the database, and a
 * rename between them is a change the operator asked for, not a collision to absorb.
 */
export async function applyTalentUpdates<T>(options: TalentUpdateOptions<T>) {
	const availableByName = new Map<string, TalentSummary[]>();
	for (const current of options.currentTalents) {
		const namesakes = availableByName.get(current.name);
		if (namesakes)
			namesakes.push(current);
		else
			availableByName.set(current.name, [current]);
	}

	const talentsToAdd = options.requestedTalents.filter((requested) => {
		const namesakes = availableByName.get(requested.name);
		if (!namesakes?.length)
			return true;

		namesakes.shift();
		return false;
	});

	const surplus = new Set(Array.from(availableByName.values()).flat());
	const talentsToRemove = options.currentTalents.filter(current => surplus.has(current));

	for (const talent of talentsToRemove) {
		const removed = await options.removeTalent(talent.id);
		if (!removed)
			throw new Error(`Failed to remove ${talent.name}`);
	}

	for (const talent of talentsToAdd) {
		const added = await options.addTalent({ name: talent.name });
		if (!added)
			throw new Error(`Failed to add ${talent.name}`);
	}
}
