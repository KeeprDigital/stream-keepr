import { ref } from 'vue';

/**
 * Stands in for `~/modules/screen-mode/editorModeData` in a settings editor's
 * test that is not about the rows the Screen pages, which the Pairings and
 * Most Played Cards editors' tests cover (#780):
 *
 *   vi.mock('~/modules/screen-mode/editorModeData', () => import('~~/test/helpers/editedScreenModeData'));
 *
 * A test of what the editor shows from its read sets `editedScreenModeData`
 * before it mounts, and resets it after.
 */
export const editedScreenModeData = {
	/** Standings: the read found no previous Round to compare positions with. */
	noPreviousRoundStandings: false,
};

export function useEditedScreenModeData() {
	return {
		rowCount: ref(0),
		loading: ref(false),
		answered: ref(true),
		noPreviousRoundStandings: ref(editedScreenModeData.noPreviousRoundStandings),
	};
}
