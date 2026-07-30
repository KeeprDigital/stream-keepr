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
	const loads = createGuardedSequence();

	watch(
		() => ({ eventId: toValue(eventId), screenId: toValue(screenId) }),
		async ({ eventId: currentEventId, screenId: currentScreenId }) => {
			const flight = loads.begin();
			assetCapability.value = null;
			if (!currentScreenId)
				return;
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
		},
		{ immediate: true },
	);

	onBeforeUnmount(() => {
		loads.supersede();
	});

	return { assetCapability: readonly(assetCapability) };
}
