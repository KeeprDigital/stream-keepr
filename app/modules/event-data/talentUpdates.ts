import type { SocialProfiles } from '~~/shared/socialProfiles';
import { SUPPORTED_SOCIAL_NETWORK_KEYS } from '~~/shared/socialProfiles';

interface TalentSummary {
	id: number;
	name: string;
	socialProfiles?: SocialProfiles;
}

/**
 * A row of the Talents card. An entry with no `id` is one the operator just added
 * and no talent exists for yet; every other entry names the talent it came from.
 */
interface RequestedTalent {
	id?: number;
	name: string;
	socialProfiles?: SocialProfiles;
}

interface TalentUpdateOptions<T> {
	currentTalents: TalentSummary[];
	requestedTalents: RequestedTalent[];
	removeTalent: (talentId: number) => Promise<unknown>;
	addTalent: (input: { name: string; socialProfiles: SocialProfiles }) => Promise<T | null>;
	updateTalent: (talentId: number, input: { name: string; socialProfiles: SocialProfiles }) => Promise<unknown>;
}

function sameSocialProfiles(first: SocialProfiles = {}, second: SocialProfiles = {}) {
	return SUPPORTED_SOCIAL_NETWORK_KEYS.every(network => first[network] === second[network]);
}

/**
 * Reconciles the Talents card's list against the event's, **by talent id**.
 *
 * Everything under this function is already keyed on ids — the `event_talents`
 * primary key, the `commentator1_talent_id` / `commentator2_talent_id` columns that
 * point at it, and the graphics binding data that resolves commentators through
 * `byId` at Take time. Only this card was keyed on names, and every defect it had
 * came from that one mismatch:
 *
 * - Two talents called "Bob" were indistinguishable, so dropping one matched the
 *   other and the save removed nothing, added nothing, and reported success. The
 *   card then reset from an unchanged event and the deleted row came back. That is
 *   how a duplicate talent became unremovable through the only screen that removes
 *   talents.
 * - A rename was a remove followed by an add, so the renamed person came back with
 *   a **new id** while the event still pointed at the old one — which the FK's
 *   `onDelete: 'set null'` had just cleared. Rename your commentator and they left
 *   the graphic, silently, with the save reporting success.
 *
 * Carrying ids through makes both questions exact rather than inferred: an entry
 * that names an existing talent keeps them (renaming in place if the name moved),
 * an entry with no id is new, and a talent no entry names was dropped. Namesakes
 * need no special handling because names stopped being the identifier.
 *
 * Renames run first so identity survives the rest of the save, and removals run
 * before additions so the pass that can free a name happens before the one that
 * might reuse it.
 */
export async function applyTalentUpdates<T>(options: TalentUpdateOptions<T>) {
	const currentById = new Map(options.currentTalents.map(talent => [talent.id, talent]));
	const keptIds = new Set<number>();
	const talentsToAdd: RequestedTalent[] = [];
	const talentsToUpdate: Array<{ current: TalentSummary; requested: RequestedTalent }> = [];

	for (const requested of options.requestedTalents) {
		const current = requested.id === undefined ? undefined : currentById.get(requested.id);

		// An id with no talent behind it is an entry whose talent went away while the
		// operator was editing. Their list is what they asked the event to be, so the
		// row is re-created rather than quietly dropped.
		if (!current) {
			talentsToAdd.push(requested);
			continue;
		}

		keptIds.add(current.id);

		if (current.name !== requested.name || !sameSocialProfiles(current.socialProfiles, requested.socialProfiles))
			talentsToUpdate.push({ current, requested });
	}

	const talentsToRemove = options.currentTalents.filter(talent => !keptIds.has(talent.id));

	for (const { current, requested } of talentsToUpdate) {
		const updated = await options.updateTalent(current.id, {
			name: requested.name,
			socialProfiles: requested.socialProfiles ?? {},
		});
		if (!updated)
			throw new Error(`Failed to update ${current.name}`);
	}

	for (const talent of talentsToRemove) {
		const removed = await options.removeTalent(talent.id);
		if (!removed)
			throw new Error(`Failed to remove ${talent.name}`);
	}

	for (const talent of talentsToAdd) {
		const added = await options.addTalent({
			name: talent.name,
			socialProfiles: talent.socialProfiles ?? {},
		});
		if (!added)
			throw new Error(`Failed to add ${talent.name}`);
	}
}
