import type { MaybeRefOrGetter } from 'vue';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import {
	graphicAssetRevisionContentPath,
	screenOutputAssetCapabilitySessionPath,
	screenOutputGraphicAssetRevisionContentPath,
} from '~~/shared/utils/graphicsAssetReferences';

function referenceKey(reference: GraphicAssetReference): string {
	return `${reference.assetId}\0${reference.revisionId}`;
}

/** The refusal codes a Screen Output asset resolution request can answer with. */
type ScreenOutputAssetRefusalCode = 'vp9-alpha-chromium-required';

/**
 * The refusals the capability session forecast for this browser, keyed exactly as
 * the URLs are.
 *
 * Read defensively rather than parsed against a schema: this is advisory, and an
 * output that cannot read it must still resolve every URL it was going to resolve.
 * A refusal it fails to learn about costs the item its notice; a session it
 * refuses to open costs the whole output its media.
 */
function unplayableRevisions(body: unknown): Map<string, ScreenOutputAssetRefusalCode> {
	const listed = (body as { unplayableRevisions?: unknown } | null)?.unplayableRevisions;
	if (!Array.isArray(listed))
		return new Map();
	const refusals = new Map<string, ScreenOutputAssetRefusalCode>();
	for (const entry of listed as Array<Partial<GraphicAssetReference> & { code?: unknown }>) {
		if (entry?.assetId && entry.revisionId && entry.code === 'vp9-alpha-chromium-required')
			refusals.set(referenceKey(entry as GraphicAssetReference), entry.code);
	}
	return refusals;
}

export function useScreenGraphicAssetContentUrls(
	references: MaybeRefOrGetter<readonly GraphicAssetReference[]>,
) {
	const { assetCapability, isPreview, screen } = useScreenContext();
	const contentUrls = shallowRef(new Map<string, string>());
	/**
	 * Which of those URLs the authoritative side has already said it will refuse
	 * this browser, and why.
	 *
	 * The session is what answers it, because the session is the one exchange this
	 * output already makes and the answer depends on the same two things it carries:
	 * which revisions the Screen publishes, and which engine is asking. Compatibility
	 * is still *decided* per resolution request against the requested revision's own
	 * facts — this only stops the client having to guess that decision from a value
	 * copied into a Media Graphic Item's configuration, which the revision's facts
	 * can outlive (#184).
	 *
	 * It is a snapshot taken when the session opened, and it can go stale in the
	 * other direction. `resolutionKey` re-resolves on the *set* of pinned revisions,
	 * and a revision id does not change when its technical facts do — so facts
	 * corrected after this instant leave the output reporting a clip the server
	 * would now serve. That direction did not exist before the forecast did, and it
	 * is the safer of the two: a legible notice naming a real refusal code rather
	 * than a blank rectangle, and it clears the next time this output opens a
	 * session. Widening the key to notice a revision's facts would mean re-resolving
	 * every URL when they change, which tears down and restarts every on-air video —
	 * a worse cost than the one it would avoid.
	 */
	const contentRefusals = shallowRef(new Map<string, ScreenOutputAssetRefusalCode>());
	const contentUrlsSettled = ref(false);
	const loads = createGuardedSequence();

	/**
	 * What a re-resolve actually depends on, as one comparable value.
	 *
	 * Deliberately a string rather than an object. A getter returning a fresh object
	 * fires this watch whenever any dependency changes *identity*, and several of
	 * them are replaced wholesale by ordinary updates — a Screen object rebuilt from
	 * a realtime message, or a references array rebuilt because some unrelated
	 * Graphic Item moved. Re-resolving clears the URL map before refetching, which
	 * empties every media `src` and tears down every image and video element. On a
	 * live output that restarts an on-air video from zero, so this has to fire only
	 * when the answer would really differ.
	 */
	const resolutionKey = computed(() => [
		screen.value?.id ?? '',
		assetCapability?.value ?? '',
		isPreview?.value === true ? 'preview' : 'live',
		// Sorted and de-duplicated: which revisions are resolvable is a set, so
		// reordering a stack, or two items pinning one revision, is not a change.
		...Array.from(new Set(toValue(references).map(referenceKey))).sort(),
	].join(''));

	watch(
		resolutionKey,
		async () => {
			const currentReferences = toValue(references);
			const screenId = screen.value?.id;
			const capability = assetCapability?.value;
			const preview = isPreview?.value === true;
			const flight = loads.begin();
			contentUrlsSettled.value = false;
			contentUrls.value = new Map();
			contentRefusals.value = new Map();
			if (preview || !screenId) {
				contentUrlsSettled.value = true;
				return;
			}
			if (!import.meta.client)
				return;
			if (!capability || currentReferences.length === 0) {
				contentUrlsSettled.value = true;
				return;
			}

			const uniqueReferences = new Map(
				currentReferences.map(reference => [referenceKey(reference), reference] as const),
			);
			const response = await fetch(screenOutputAssetCapabilitySessionPath(screenId), {
				method: 'POST',
				headers: { authorization: `Bearer ${capability}` },
			}).catch(() => undefined);
			if (flight.stale)
				return;
			if (!response?.ok) {
				contentUrlsSettled.value = true;
				return;
			}
			const forecast = unplayableRevisions(await response.json().catch(() => undefined));
			if (flight.stale)
				return;
			contentRefusals.value = forecast;
			contentUrls.value = new Map(Array.from(uniqueReferences, ([key, reference]) => [
				key,
				screenOutputGraphicAssetRevisionContentPath(screenId, reference),
			]));
			contentUrlsSettled.value = true;
		},
		{ immediate: true },
	);

	onBeforeUnmount(() => {
		loads.supersede();
	});

	function contentUrl(reference: GraphicAssetReference): string {
		if (isPreview?.value === true)
			return graphicAssetRevisionContentPath(reference);
		return contentUrls.value.get(referenceKey(reference)) ?? '';
	}

	/**
	 * Why this output expects to be refused one exact revision, if it does.
	 *
	 * An editor preview resolves content as an author rather than through a
	 * capability, so it is never forecast a refusal and never reports one.
	 */
	function contentRefusal(
		reference: GraphicAssetReference,
	): ScreenOutputAssetRefusalCode | undefined {
		if (isPreview?.value === true)
			return undefined;
		return contentRefusals.value.get(referenceKey(reference));
	}

	return { contentUrl, contentRefusal, contentUrlsSettled: readonly(contentUrlsSettled) };
}
