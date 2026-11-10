import type { MaybeRefOrGetter } from 'vue';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import {
	graphicAssetRevisionContentPath,
	screenOutputAssetCapabilitySessionPath,
	screenOutputGraphicAssetRevisionContentPath,
} from '~~/shared/utils/graphicsAssetReferences';
import { SCREEN_MODE_REREAD_MS } from '~/modules/screen-mode/freshness';

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
	/** The Screen and capability the held URLs were resolved through. */
	let heldSession = '';
	let retry: ReturnType<typeof setTimeout> | undefined;

	/**
	 * What a re-resolve actually depends on, as one comparable value.
	 *
	 * Deliberately a string rather than an object. A getter returning a fresh object
	 * fires this watch whenever any dependency changes *identity*, and several of
	 * them are replaced wholesale by ordinary updates — a Screen object rebuilt from
	 * a realtime message, or a references array rebuilt because some unrelated
	 * Graphic Item moved. Re-resolving goes unsettled and asks for the session again,
	 * so this has to fire only when the answer would really differ.
	 */
	const resolutionKey = computed(() => [
		screen.value?.id ?? '',
		assetCapability?.value ?? '',
		isPreview?.value === true
			? 'preview'
			: 'live',
		// Sorted and de-duplicated: which revisions are resolvable is a set, so
		// reordering a stack, or two items pinning one revision, is not a change.
		...Array.from(new Set(toValue(references).map(referenceKey))).sort(),
	].join(''));

	/**
	 * URLs already resolved stay put while the same Screen and capability re-resolve,
	 * and through a refusal: an emptied `src` tears down every image and video
	 * element, which on a live output restarts an on-air video from zero. Only a
	 * different Screen or capability makes the held URLs wrong.
	 */
	async function resolve() {
		const currentReferences = toValue(references);
		const screenId = screen.value?.id;
		const capability = assetCapability?.value;
		const preview = isPreview?.value === true;
		const flight = loads.begin();
		clearTimeout(retry);
		contentUrlsSettled.value = false;
		const session = preview || !screenId || !capability
			? ''
			: `${screenId}\0${capability}`;
		if (session !== heldSession || session === '') {
			heldSession = '';
			contentUrls.value = new Map();
		}
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
			currentReferences.map(reference => [
				referenceKey(reference),
				reference,
			] as const),
		);
		const response = await fetch(screenOutputAssetCapabilitySessionPath(screenId), {
			method: 'POST',
			headers: { authorization: `Bearer ${capability}` },
		}).catch(() => undefined);
		if (flight.stale)
			return;
		if (!response?.ok) {
			// The session route answers 503 when its catalogue is briefly unreachable;
			// giving up there would leave the output without media until a reload.
			retry = setTimeout(() => void resolve(), SCREEN_MODE_REREAD_MS);
			contentUrlsSettled.value = true;
			return;
		}
		heldSession = session;
		contentUrls.value = new Map(Array.from(uniqueReferences, ([key, reference]) => [
			key,
			screenOutputGraphicAssetRevisionContentPath(screenId, reference),
		]));
		contentUrlsSettled.value = true;
	}

	watch(resolutionKey, resolve, { immediate: true });

	onBeforeUnmount(() => {
		loads.supersede();
		clearTimeout(retry);
	});

	function contentUrl(reference: GraphicAssetReference): string {
		if (isPreview?.value === true)
			return graphicAssetRevisionContentPath(reference);
		return contentUrls.value.get(referenceKey(reference)) ?? '';
	}

	return {
		contentUrl,
		contentUrlsSettled: readonly(contentUrlsSettled),
	};
}
