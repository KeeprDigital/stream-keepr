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

export function useScreenGraphicAssetContentUrls(
	references: MaybeRefOrGetter<readonly GraphicAssetReference[]>,
) {
	const { assetCapability, isPreview, screen } = useScreenContext();
	const contentUrls = shallowRef(new Map<string, string>());
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

	return { contentUrl, contentUrlsSettled: readonly(contentUrlsSettled) };
}
