import type { MaybeRefOrGetter } from 'vue';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import {
	graphicAssetRevisionContentPath,
	screenOutputGraphicAssetRevisionContentPath,
} from '~~/shared/utils/graphicsAssetReferences';

function referenceKey(reference: GraphicAssetReference): string {
	return `${reference.assetId}\0${reference.revisionId}`;
}

export function useScreenGraphicAssetContentUrls(
	references: MaybeRefOrGetter<readonly GraphicAssetReference[]>,
) {
	const { assetCapability, isPreview, screen } = useScreenContext();
	const objectUrls = shallowRef(new Map<string, string>());
	const contentUrlsSettled = ref(false);
	const loads = createGuardedSequence();

	function revoke(urls: Map<string, string>) {
		for (const url of urls.values())
			URL.revokeObjectURL(url);
	}

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
			const previous = objectUrls.value;
			if (preview || !screenId || !capability || currentReferences.length === 0) {
				objectUrls.value = new Map();
				contentUrlsSettled.value = true;
				revoke(previous);
				return;
			}

			const uniqueReferences = new Map(
				currentReferences.map(reference => [referenceKey(reference), reference] as const),
			);
			const resolved = new Map<string, string>();
			await Promise.all(Array.from(uniqueReferences, async ([key, reference]) => {
				try {
					const response = await fetch(
						screenOutputGraphicAssetRevisionContentPath(screenId, reference),
						{ headers: { authorization: `Bearer ${capability}` } },
					);
					if (flight.stale)
						return;
					if (!response.ok)
						return;
					const blob = await response.blob();
					if (flight.stale) {
						return;
					}
					const url = URL.createObjectURL(blob);
					resolved.set(key, url);
				}
				catch {
					// The renderer stays blank for this exact revision; it never substitutes bytes.
				}
			}));
			if (flight.stale) {
				revoke(resolved);
				return;
			}
			objectUrls.value = resolved;
			contentUrlsSettled.value = true;
			revoke(previous);
		},
		{ immediate: true },
	);

	onBeforeUnmount(() => {
		loads.supersede();
		revoke(objectUrls.value);
	});

	function contentUrl(reference: GraphicAssetReference): string {
		if (isPreview?.value === true)
			return graphicAssetRevisionContentPath(reference);
		return objectUrls.value.get(referenceKey(reference)) ?? '';
	}

	return { contentUrl, contentUrlsSettled: readonly(contentUrlsSettled) };
}
