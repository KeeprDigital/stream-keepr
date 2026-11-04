import type { WritableComputedRef } from 'vue';
import { useLocalStorage } from '@vueuse/core';
import { readLayerLocks } from '~/modules/feature-match-overlay/layerLocks';

/**
 * A Screen's Layer Locks (#747), remembered per browser per Screen: editor state,
 * never stored in the Feature Match Layout, so another browser or session keeps
 * its own. A browser that refuses storage still locks for this visit.
 */
export function useFeatureMatchLayoutLocks(screenId: number): WritableComputedRef<string[]> {
	let stored: Ref<unknown>;
	try {
		// Read on mount, so a server render and the first client render agree.
		stored = useLocalStorage<unknown>(`editor-featureMatchLayoutLocks:${screenId}`, [], {
			initOnMounted: true,
			onError: () => {},
		});
	}
	catch {
		stored = ref([]);
	}
	return computed({
		get: () => readLayerLocks(stored.value),
		set: (locks) => {
			stored.value = locks;
		},
	});
}
