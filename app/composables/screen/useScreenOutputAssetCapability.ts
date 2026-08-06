import type { MaybeRefOrGetter } from 'vue';
import { createGuardedSequence } from '~/utils/guardedSequence';

/**
 * The Screen Output Asset Capability an authoring surface hands to an output it
 * embeds.
 *
 * An embedded output is a real Screen Output, not a preview: it resolves Graphic
 * Asset content only through a capability, and has no other route to the bytes. So
 * a surface that embeds one has to obtain a capability and put it in the output's
 * URL, or that output shows every graphic except its media.
 *
 * Null while loading, and null if the request fails: an absent capability renders
 * no media rather than falling back to some other route, which is the property the
 * capability exists to guarantee.
 */
export function useScreenOutputAssetCapability(
	eventId: MaybeRefOrGetter<number>,
	screenId: MaybeRefOrGetter<number | undefined>,
) {
	const assetCapability = ref<string | null>(null);
	/**
	 * Whether the answer is in yet, which a null capability cannot say by itself.
	 *
	 * Null means "not loaded" and "could not be loaded" at once, and an embedder has
	 * to tell those apart before it does anything: an output URL built during the
	 * first is a URL that will be correct in a moment, and one built during the second
	 * never will be. An embedder that navigates on the first hands itself a Screen
	 * Output that renders no media and can never recover, because a navigation is not
	 * re-run when a later fetch succeeds (#231).
	 */
	const settled = ref(false);
	const loads = createGuardedSequence();

	watch(
		() => ({ eventId: toValue(eventId), screenId: toValue(screenId) }),
		async ({ eventId: currentEventId, screenId: currentScreenId }) => {
			const flight = loads.begin();
			assetCapability.value = null;
			settled.value = false;
			if (!currentScreenId) {
				settled.value = true;
				return;
			}
			try {
				const result = await $fetch<{ assetCapability: string }>(
					`/api/events/${currentEventId}/screens/${currentScreenId}/asset-capability`,
				);
				if (flight.current)
					assetCapability.value = result.assetCapability;
			}
			catch {
				if (flight.current)
					assetCapability.value = null;
			}
			finally {
				if (flight.current)
					settled.value = true;
			}
		},
		{ immediate: true },
	);

	onBeforeUnmount(() => {
		loads.supersede();
	});

	return { assetCapability: readonly(assetCapability), assetCapabilitySettled: readonly(settled) };
}
