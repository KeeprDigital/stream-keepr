import { useLocalStorage } from '@vueuse/core';

const INSPECTOR_SECTIONS_STORAGE_KEY = 'editor-inspectorSections';

function rememberedSections(): Ref<Record<string, boolean>> {
	try {
		// Read on mount, so a server render and the first client render agree.
		return useLocalStorage<Record<string, boolean>>(INSPECTOR_SECTIONS_STORAGE_KEY, {}, { initOnMounted: true });
	}
	catch {
		// A browser that refuses storage still collapses sections for this view.
		return ref({});
	}
}

/**
 * Which property panel sections an author has collapsed, remembered per browser
 * by section id rather than per item — so collapsing Typography once keeps it
 * collapsed on every text item that follows, in either graphics editor.
 *
 * A convenience, never configuration: an unknown or unreadable entry falls back
 * to the section's own default.
 */
export function useInspectorSections() {
	const stored = rememberedSections();

	function isOpen(id: string, defaultOpen = true): boolean {
		return stored.value[id] ?? defaultOpen;
	}

	function setOpen(id: string, open: boolean) {
		stored.value = { ...stored.value, [id]: open };
	}

	function setAll(ids: readonly string[], open: boolean) {
		stored.value = { ...stored.value, ...Object.fromEntries(ids.map(id => [id, open])) };
	}

	return { isOpen, setOpen, setAll };
}
