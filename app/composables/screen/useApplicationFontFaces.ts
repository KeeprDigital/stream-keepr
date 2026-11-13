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
 * `useGraphicAssetFontFaces` waits for its library fonts, so Rendering Readiness
 * holds the rendering off program until they have loaded or failed (ADR-0053).
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
 * The set settles only once every load has: a face that rejects early does not
 * release the hold while another is still loading.
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
	 * requests on any configuration edit, and reloading on identity would unsettle
	 * a settled output for an edit that names no new face (#160).
	 */
	const loadKey = computed(() => fonts.value.join('\n'));

	watch(loadKey, async () => {
		const pending = fonts.value;
		const flight = loads.begin();
		fontsReady.value = pending.length === 0;
		fontsFailed.value = false;
		if (pending.length === 0 || !import.meta.client)
			return;
		const loaded = await Promise.allSettled(pending.map(async font => document.fonts.load(font)));
		if (flight.stale)
			return;
		if (loaded.every(result => result.status === 'fulfilled' && result.value.length > 0))
			fontsReady.value = true;
		else
			fontsFailed.value = true;
	}, { immediate: true });

	onScopeDispose(() => loads.supersede());

	return {
		fontsReady: readonly(fontsReady),
		fontsFailed: readonly(fontsFailed),
	};
}

/**
 * A font host's library and application fonts as one, as Rendering Readiness
 * and `data-font-ready` / `data-font-error` read them: ready once both are,
 * failed once both have settled with either failed. A failure beside a load
 * still pending is held back, so ready-or-failed means both have settled.
 *
 * Only readiness reads the application fonts. A host's display hides while its
 * library fonts load and never for an application font, which holds the
 * rendering off program instead and, once it is on program, swaps in late.
 */
export function useCombinedFontFaces(library: FontFaceState, application: FontFaceState): FontFaceState {
	const settled = (state: FontFaceState) => state.fontsReady.value || state.fontsFailed.value;
	return {
		fontsReady: computed(() => library.fontsReady.value && application.fontsReady.value),
		fontsFailed: computed(() => settled(library) && settled(application)
			&& (library.fontsFailed.value || application.fontsFailed.value)),
	};
}
