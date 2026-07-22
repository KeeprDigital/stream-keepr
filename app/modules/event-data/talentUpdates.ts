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

export async function applyTalentUpdates<T>(options: TalentUpdateOptions<T>) {
	const talentsToAdd = options.requestedTalents.filter(
		requested => !options.currentTalents.some(current => current.name === requested.name),
	);
	const talentsToRemove = options.currentTalents.filter(
		current => !options.requestedTalents.some(requested => requested.name === current.name),
	);

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
