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

	watch(
		() => ({
			references: toValue(references),
			screenId: screen.value?.id,
			capability: assetCapability?.value,
			preview: isPreview?.value === true,
		}),
		async ({ references: currentReferences, screenId, capability, preview }) => {
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
