import type { MaybeRefOrGetter } from 'vue';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { ScreenGraphicAssetReference } from '~~/shared/utils/graphicsAssetReferences';
import { graphicAssetFontFaceFamily } from '~~/shared/modules/graphics/typography';
import { createGuardedSequence } from '~/utils/guardedSequence';

interface FontSource {
	family: string;
	url: string;
}

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
	/** The families and URLs `loadedFontFaces` were loaded from, as comparable values. */
	let loadedFamilies = '';
	let loadedSources = '';

	function discard(faces: readonly FontFace[]) {
		for (const face of faces)
			document.fonts.delete(face);
	}

	function familyKey(entries: readonly FontSource[]) {
		return entries.map(({ family }) => family).sort().join('\0');
	}

	function sourceKey(entries: readonly FontSource[]) {
		return entries.map(({ family, url }) => `${family}\0${url}`).sort().join('');
	}

	/**
	 * One entry per distinct family rather than per reference: two Graphic Items
	 * pinning one revision are one `FontFace`, and registering it twice would leave
	 * the second copy in `document.fonts` after the first is discarded.
	 */
	const sources = computed<FontSource[]>(() => {
		const byFamily = new Map(toValue(references)
			.filter(item => item.kind === 'font')
			.map(({ reference }) => {
				const family = graphicAssetFontFaceFamily(reference);
				return [family, { family, url: contentUrl(reference) }] as const;
			}));
		return [...byFamily.values()];
	});

	/**
	 * When it is worth asking whether anything needs loading, as one comparable value.
	 *
	 * Deliberately a string rather than the sources themselves. A host rebuilds its
	 * whole indexed reference list on any configuration change — an operator
	 * recolouring a Frame, a Take or an Update Graphic that changes the stack — so a
	 * watch keyed on a fresh object wakes for edits that name no font at all. Waking
	 * mattered because the body used to discard every registered face and put
	 * `fontsReady` back to false unconditionally, which blanks a settled Screen Output:
	 * precisely the failure the hiding above exists to prevent. Hiding is the right
	 * answer for a font that has not loaded yet and the wrong one for a font that
	 * loaded a minute ago and has not changed.
	 *
	 * This is a filter and not the whole answer. It cannot be, because the settled flag
	 * it leads with is a round trip: it leaves and returns to the same value, so the key
	 * either side of an unsettled window is identical and the change through it is real
	 * enough to fire on. What makes the window a no-op is the body comparing against the
	 * faces actually registered.
	 */
	const loadKey = computed(() =>
		// Sorted, over one entry per family: which faces are required is a set, so
		// reordering a stack is not a change. The URL is part of the key because the
		// same family resolved through a different Screen Output Asset Capability is
		// different bytes to fetch.
		`${toValue(contentUrlsSettled) ? 'settled' : 'unsettled'}${sourceKey(sources.value)}`);

	watch(loadKey, async () => {
		const settled = toValue(contentUrlsSettled);
		const pending = sources.value;

		/*
		 * An unsettled window is the absence of an answer rather than a different one.
		 * `useScreenGraphicAssetContentUrls` clears its whole URL map and goes unsettled
		 * whenever the Screen's *asset reference set* changes — for any asset kind, not
		 * just fonts — so a Take that brings on an image drives this composable through
		 * one of those windows with every font reference untouched. Both legs of it have
		 * to be sat through: the faces required are still the faces loaded, and the map
		 * comes back holding the same URLs it was cleared of.
		 *
		 * Families rather than URLs on the way down, because the URLs are exactly what
		 * is missing there; the family is derived from the pinned revision and says what
		 * is required without needing to know where it lives yet. On the way back the
		 * full source key is comparable again, and it is compared against what is
		 * actually registered rather than against the previous key — which is what makes
		 * an unchanged round trip a no-op instead of a discard and a reload.
		 */
		if (!settled && familyKey(pending) === loadedFamilies)
			return;
		if (settled && fontsReady.value && sourceKey(pending) === loadedSources)
			return;

		const flight = loads.begin();
		fontsReady.value = pending.length === 0;
		fontsFailed.value = false;
		if (!import.meta.client)
			return;
		discard(loadedFontFaces);
		loadedFontFaces = [];
		loadedFamilies = '';
		loadedSources = '';
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
			loadedFamilies = familyKey(pending);
			loadedSources = sourceKey(pending);
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
