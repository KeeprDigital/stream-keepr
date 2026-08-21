import type { MaybeRefOrGetter } from 'vue';

/**
 * How many Screen Outputs open on one Screen right now are rendering degraded
 * card data.
 *
 * A deck-type rendering whose Scryfall fetch exhausted its retries stays on
 * program showing placeholder cards — deliberately, because an output never
 * blanks for missing card images — and re-fetches on its own until the data
 * resolves (#465). From the venue that looks identical to a deck whose images
 * simply have not been noticed yet, so the output says: the report travels
 * through Screen presence exactly as the asset-access report does (#231), and
 * this is the control-surface reading of it.
 *
 * Counted rather than named because the operator's next action does not vary by
 * which output it is — the outputs are already re-fetching; the count says
 * whether program is currently degraded and when it has recovered.
 *
 * Only outputs that report the field at all are counted. An output that reports
 * nothing is silent about its card data rather than lacking it, and counting a
 * silence would put a fault in front of an operator that no browser stands
 * behind.
 */
export function useScreenOutputCardDataHealth(
	screenId: MaybeRefOrGetter<number>,
): ComputedRef<number> {
	const screenStore = useScreenStore();

	return computed(() => {
		const members = screenStore.screenPresence.get(toValue(screenId))?.members ?? [];
		return members.filter(member => member.data?.cardData === 'degraded').length;
	});
}
