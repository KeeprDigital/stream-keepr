import { useRememberedOpenState } from '~/composables/ui/useRememberedOpenState';

const INSPECTOR_SECTIONS_STORAGE_KEY = 'editor-inspectorSections';

/**
 * Which property panel sections an author has collapsed, remembered per browser
 * by section id rather than per item — so collapsing Typography once keeps it
 * collapsed on every text item that follows, in either graphics editor.
 */
export function useInspectorSections() {
	return useRememberedOpenState(INSPECTOR_SECTIONS_STORAGE_KEY);
}
