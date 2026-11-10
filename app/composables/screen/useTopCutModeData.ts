import type { ScreenOutputTopCutResponse } from '~~/shared/types/screenOutputReads';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { EMPTY_TOP_CUT_BRACKET } from '~~/shared/modules/top-cut-bracket';
import { topCutBracketSource } from '~~/shared/screenModeConfigs/topCut';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { useScreenModeHearing } from '~/modules/screen-mode/hearing';

const NO_BRACKET: ScreenOutputTopCutResponse = { phase: null, bracket: EMPTY_TOP_CUT_BRACKET };

/**
 * What a Top Cut Bracket Screen renders: the bracket of the Phase its configuration
 * names, or its Manual Bracket (ADR-0075), read through the Screen and kept
 * current by Screen Mode Data Freshness.
 */
export function useTopCutModeData(context: ScreenContext) {
	const config = useScreenModeConfig(context, 'top-cut');
	const game = useScreenCardGame(context);
	const outputReads = useScreenOutputReads(context);
	const source = computed(() => topCutBracketSource(game.value, config.value));

	// The server reads the source itself; this only says when what it reads may have changed.
	const readKey = () => {
		const scope = outputReads.scopeKey.value;
		if (!scope)
			return null;
		const shown = `${config.value.showSeeds}:${config.value.showArchetypes}:${config.value.playerNameShown}`;
		if (source.value === 'manual')
			return `${scope}:manual:${JSON.stringify(config.value.manualBracket)}:${shown}`;
		return config.value.phaseId
			? `${scope}:${config.value.phaseId}:${config.value.bracketSizeOverride ?? 'auto'}:${shown}`
			: null;
	};
	const freshness = useScreenModeFreshness<ScreenOutputTopCutResponse>({
		hearing: useScreenModeHearing(context, 'top-cut', () => config.value),
		source: readKey,
		read: () => outputReads.topCut(),
		initialData: NO_BRACKET,
		errorMessage: 'Failed to load the bracket',
	});
	const loading = freshness.loading;
	const error = freshness.error;
	const phase = computed(() => freshness.data.value.phase);
	const bracket = computed(() => freshness.data.value.bracket);

	const headerText = computed(() => config.value.headerText || phase.value?.name || 'Top Cut');
	const isEmpty = computed(() => freshness.answered.value && (
		(source.value === 'phase' && !config.value.phaseId)
		|| bracket.value.columns.length === 0));

	return {
		/** Rendering Readiness: its first read has answered or failed. */
		ready: freshness.answered,
		config,
		loading,
		error,
		isEmpty,
		headerText,
		phase,
		bracket,
	};
}
