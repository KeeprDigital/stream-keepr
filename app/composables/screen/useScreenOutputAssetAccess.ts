import type { MaybeRefOrGetter } from 'vue';

/**
 * How many Screen Outputs open on one Screen right now cannot resolve its media.
 *
 * A Screen Output resolves Graphic Asset content only through a Screen Output Asset
 * Capability, which it carries in its own URL. An output opened without one is not
 * broken and does not fail: it renders every Shape and Text the Screen publishes and
 * silently omits every image and video, which from the operator's side is
 * indistinguishable from a composition that simply has no media on air. That is the
 * failure #231 was found by — on program, while every editor surface showed the
 * media correctly.
 *
 * So the output says. This mirrors the Open Screen Output Engines exactly, and for
 * the same reason: what is true of the browsers watching right now is a fact only
 * they hold, and a control surface can only state it if they report it.
 *
 * Counted rather than named because the operator's next action does not vary by
 * which output it is — re-open it from the copy or open control on this Screen,
 * which is the only place a URL carrying the capability comes from.
 *
 * Only outputs that report the field at all are counted. An output that reports
 * nothing is silent about its asset access rather than lacking it, and counting a
 * silence would put a fault in front of an operator that no browser stands behind.
 */
export function useScreenOutputAssetAccess(
	screenId: MaybeRefOrGetter<number>,
): ComputedRef<number> {
	const screenStore = useScreenStore();

	return computed(() => {
		const members = screenStore.screenPresence.get(toValue(screenId))?.members ?? [];
		return members.filter(member => member.data?.assetAccess === 'absent').length;
	});
}
