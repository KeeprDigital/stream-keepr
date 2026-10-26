import { ref } from 'vue';

/**
 * Stands in for `~/modules/screen-mode/editorModeData` in a settings editor's
 * test that is not about the rows the Screen pages, which the Pairings and
 * Most Played Cards editors' tests cover (#780):
 *
 *   vi.mock('~/modules/screen-mode/editorModeData', () => import('~~/test/helpers/editedScreenModeData'));
 */
export function useEditedScreenModeData() {
	return {
		rowCount: ref(0),
		loading: ref(false),
	};
}
