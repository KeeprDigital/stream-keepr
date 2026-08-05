import type { MaybeRefOrGetter } from 'vue';
import type { GraphicsVideoTarget } from '~~/shared/utils/graphicAssetTargetCompatibility';
import type { ScreenPresenceData } from '~/types/screen';
import { graphicsVideoTargetForUserAgent } from '~~/shared/utils/graphicAssetTargetCompatibility';

/**
 * The browser engines the Screen Outputs currently open on one Screen are running.
 *
 * Playback compatibility is decided per resolution request against the engine on the
 * other end of it (#98), so what a Graphic Asset Revision costs is a fact about the
 * outputs that are open rather than about the Screen. This is how a control surface
 * can state that cost before an operator chooses, instead of leaving it to be
 * discovered on air.
 *
 * Only a Screen Output enters this Screen's presence — a control surface watches it
 * without joining — so every member here is an output.
 *
 * An output reporting no user agent contributes nothing. Guessing an engine for it
 * would put a compatibility claim in front of an operator that no connected browser
 * stands behind, and the honest answer to "what is open" is the outputs that said.
 */
export function useScreenOutputVideoTargets(
	screenId: MaybeRefOrGetter<number>,
): ComputedRef<GraphicsVideoTarget[]> {
	const screenStore = useScreenStore();

	return computed(() => {
		const members = screenStore.screenPresence.get(toValue(screenId))?.members ?? [];
		const targets = new Set<GraphicsVideoTarget>();
		for (const member of members) {
			const userAgent = (member as { data?: Partial<ScreenPresenceData> } | null)?.data?.userAgent;
			if (typeof userAgent === 'string' && userAgent !== '')
				targets.add(graphicsVideoTargetForUserAgent(userAgent));
		}
		return [...targets];
	});
}
