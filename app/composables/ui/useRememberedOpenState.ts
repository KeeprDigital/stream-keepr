import { useLocalStorage } from '@vueuse/core';

function rememberedOpenState(storageKey: string): Ref<Record<string, boolean>> {
	try {
		// Read on mount, so a server render and the first client render agree.
		return useLocalStorage<Record<string, boolean>>(storageKey, {}, { initOnMounted: true });
	}
	catch {
		// A browser that refuses storage still collapses for this view.
		return ref({});
	}
}

/**
 * Which collapsible panels are open, remembered per browser under one storage
 * key, by panel id.
 *
 * A convenience, never configuration: an unknown or unreadable entry falls back
 * to the panel's own default.
 */
export function useRememberedOpenState(storageKey: string) {
	const stored = rememberedOpenState(storageKey);

	function isOpen(id: string, defaultOpen = true): boolean {
		return stored.value[id] ?? defaultOpen;
	}

	function setOpen(id: string, open: boolean) {
		stored.value = { ...stored.value, [id]: open };
	}

	return { isOpen, setOpen };
}
