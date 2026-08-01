import type { MaybeRefOrGetter } from 'vue';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { ScreenGraphicAssetReference } from '~~/shared/utils/graphicsAssetReferences';
import { graphicAssetFontFaceFamily } from '~~/shared/modules/graphics/typography';
import { createGuardedSequence } from '~/utils/guardedSequence';

/**
 * Loads the exact font Graphic Asset Revisions a graphics Screen Output paints,
 * as `FontFace`s registered under the family its typography resolves to.
 *
 * Shared by both graphics hosts, because a library font is Shared Graphics
 * Foundation vocabulary now rather than one host's capability: a Feature Match
 * Layout and a Broadcast Graphic name one the same way, discover it through the
 * same walk, and resolve it through the same Screen Output Asset Capability.
 *
 * ## Why the output hides until they are ready
 *
 * A `FontFace` that has not loaded paints in a fallback family, so an output shown
 * while loading flashes the wrong typeface on air and reflows when the real one
 * arrives. Hiding is the lesser failure: a Screen Output that is briefly blank is
 * a Screen Output an operator can see is not ready, and `data-font-ready` says so
 * for anything watching. A layout naming no library font is ready immediately and
 * never waits.
 *
 * A revision whose bytes cannot be resolved is reported rather than substituted.
 * A Missing Graphic Asset Reference is an integrity failure, and quietly painting
 * some other font would hide it at exactly the moment it matters.
 *
 * It takes a host's whole indexed reference list and picks the fonts out itself.
 * Both Displays otherwise wrote the same filter beside the same comment, and a
 * filter each host maintains separately is a filter one of them can come to
 * disagree with `graphicsAssetReferences` about.
 */
export function useGraphicAssetFontFaces(
	references: MaybeRefOrGetter<readonly ScreenGraphicAssetReference[]>,
	contentUrl: (reference: GraphicAssetReference) => string,
	contentUrlsSettled: MaybeRefOrGetter<boolean>,
) {
	const fontsReady = ref(true);
	const fontsFailed = ref(false);
	const loads = createGuardedSequence();
	let loadedFontFaces: FontFace[] = [];

	function discard(faces: readonly FontFace[]) {
		for (const face of faces)
			document.fonts.delete(face);
	}

	/**
	 * One entry per distinct family rather than per reference: two Graphic Items
	 * pinning one revision are one `FontFace`, and registering it twice would leave
	 * the second copy in `document.fonts` after the first is discarded.
	 */
	const sources = computed(() => {
		const settled = toValue(contentUrlsSettled);
		const byFamily = new Map(toValue(references)
			.filter(item => item.kind === 'font')
			.map(({ reference }) => {
				const family = graphicAssetFontFaceFamily(reference);
				return [family, { family, url: contentUrl(reference) }] as const;
			}));
		return { settled, sources: [...byFamily.values()] };
	});

	watch(sources, async ({ settled, sources: pending }) => {
		const flight = loads.begin();
		fontsReady.value = pending.length === 0;
		fontsFailed.value = false;
		if (!import.meta.client)
			return;
		discard(loadedFontFaces);
		loadedFontFaces = [];
		if (pending.length === 0 || !settled)
			return;

		const faces: FontFace[] = [];
		try {
			for (const { family, url } of pending) {
				if (!url)
					throw new Error('Exact font revision content is unavailable.');
				const face = new FontFace(family, `url("${url.replaceAll('"', '%22')}")`);
				faces.push(face);
				document.fonts.add(face);
				await face.load();
				if (flight.stale) {
					discard(faces);
					return;
				}
				// Asking the document as well as the face: a face that loaded is not yet a
				// face the renderer will use, and the sample covers the digits and letters
				// a scoreboard actually paints.
				await document.fonts.load(`48px "${family}"`, 'Aa 012 Player Name');
				if (flight.stale) {
					discard(faces);
					return;
				}
				if (!document.fonts.check(`48px "${family}"`, 'Aa 012 Player Name'))
					throw new Error('Exact font revision is not ready.');
			}
			await document.fonts.ready;
			if (flight.stale) {
				discard(faces);
				return;
			}
			loadedFontFaces = faces;
			fontsReady.value = true;
		}
		catch {
			discard(faces);
			if (flight.current)
				fontsFailed.value = true;
		}
	}, { immediate: true });

	onBeforeUnmount(() => {
		loads.supersede();
		discard(loadedFontFaces);
	});

	return {
		fontsReady: readonly(fontsReady),
		fontsFailed: readonly(fontsFailed),
	};
}
