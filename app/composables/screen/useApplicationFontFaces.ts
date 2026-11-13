import type { MaybeRefOrGetter, Ref } from 'vue';
import type { ApplicationFontFaceRequest } from '~~/shared/modules/graphics/typography';
import { getGraphicFontDefinition } from '~~/shared/modules/graphics/typography';
import { createGuardedSequence } from '~/utils/guardedSequence';

/** Whether a host's fonts have loaded, or failed; settled once either holds. */
export interface FontFaceState {
	fontsReady: Readonly<Ref<boolean>>;
	fontsFailed: Readonly<Ref<boolean>>;
}

/**
 * Waits for the application faces a Screen Output paints, as
 * `useGraphicAssetFontFaces` waits for its library fonts, so its host can hide
 * its display until they are ready (ADR-0053).
 *
 * An application font reaches the page through the bundle's `@font-face` with
 * `font-display: swap`: the browser fetches a face only once text asks for it,
 * and paints the fallback until it arrives, so on a cold cache the display cuts
 * to air in the wrong face and reflows. `document.fonts.load` fetches each face
 * ahead. With its default text it selects the faces whose `unicode-range` covers
 * a space, the Latin subset; a face for another script swaps in when first painted.
 *
 * A load that rejects, or answers no face because the family is not declared,
 * fails rather than waits: its host shows the fallback, as for a library font.
 */
export function useApplicationFontFaces(
	requests: MaybeRefOrGetter<readonly ApplicationFontFaceRequest[]>,
): FontFaceState {
	const fontsReady = ref(true);
	const fontsFailed = ref(false);
	const loads = createGuardedSequence();

	/** The `font` shorthand of each distinct packaged face; a system stack has none to load. */
	const fonts = computed(() => [
		...new Set(toValue(requests).flatMap(({ fontId, weight, style }) => {
			const family = getGraphicFontDefinition(fontId)?.package?.family;
			return family
				? [`${style} ${weight} 1em "${family}"`]
				: [];
		})),
	].sort());

	/**
	 * Which faces are required, as one comparable value. A host rebuilds its
	 * requests on any configuration edit, and reloading on identity would hide a
	 * settled output for an edit that names no new face (#160).
	 */
	const loadKey = computed(() => fonts.value.join('\n'));

	watch(loadKey, async () => {
		const pending = fonts.value;
		const flight = loads.begin();
		fontsReady.value = pending.length === 0;
		fontsFailed.value = false;
		if (pending.length === 0 || !import.meta.client)
			return;
		try {
			const faces = await Promise.all(pending.map(font => document.fonts.load(font)));
			if (flight.stale)
				return;
			if (faces.every(loaded => loaded.length > 0))
				fontsReady.value = true;
			else
				fontsFailed.value = true;
		}
		catch {
			if (flight.current)
				fontsFailed.value = true;
		}
	}, { immediate: true });

	onScopeDispose(() => loads.supersede());

	return {
		fontsReady: readonly(fontsReady),
		fontsFailed: readonly(fontsFailed),
	};
}

/**
 * A font host's library and application fonts as one, and whether its display
 * shows.
 *
 * Rendering Readiness reads the combination: ready once both are, failed once
 * both have settled with either failed. A failure beside a load still pending is
 * held back, so ready-or-failed means both have settled.
 *
 * The display hides while a library font loads, as it always has. An
 * application font hides it only before its first show: once its faces have
 * settled once, or the rendering is on program (past its timeout included), a
 * face that arrives late swaps in rather than taking a shown display off air.
 */
export function useCombinedFontFaces(
	library: FontFaceState,
	application: FontFaceState,
	onProgram: MaybeRefOrGetter<boolean>,
): FontFaceState & { fontsVisible: Readonly<Ref<boolean>> } {
	const settled = (state: FontFaceState) => state.fontsReady.value || state.fontsFailed.value;
	const applicationSettled = computed(() => settled(application));
	const applicationSettledOnce = ref(false);
	watch(applicationSettled, (isSettled) => {
		if (isSettled)
			applicationSettledOnce.value = true;
	}, { immediate: true, flush: 'sync' });

	return {
		fontsReady: computed(() => library.fontsReady.value && application.fontsReady.value),
		fontsFailed: computed(() => settled(library) && applicationSettled.value
			&& (library.fontsFailed.value || application.fontsFailed.value)),
		fontsVisible: computed(() => settled(library)
			&& (applicationSettledOnce.value || toValue(onProgram))),
	};
}
