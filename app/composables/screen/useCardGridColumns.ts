import type { ScreenModeTokenOfType } from '~~/shared/screenModes';
import type { CardSizing } from '~~/shared/types/enums';
import { DEFAULT_EVENT_CANVAS } from '~~/shared/eventCanvas';
import { DEFAULT_THEME_TOKENS } from '~~/shared/modules/theme';
import { fitColumns, fixedColumns } from '~~/shared/utils/cardGrid';
import { screenLayoutTokens, screenModeDimensionTokens } from '~/modules/screen-mode';

type CardGridMode = 'top-cards' | 'deck';

export interface CardGridColumnsOptions<M extends CardGridMode> {
	mode: M;
	sizing: () => CardSizing;
	autoColumns: () => boolean;
	/** The operator's column count, which auto columns replaces. */
	columns: () => number;
	/** The cards the grid lays out, across every page. */
	count: () => number;
	cardWidthToken: ScreenModeTokenOfType<M, 'dimension'>;
	gapToken: ScreenModeTokenOfType<M, 'dimension'>;
}

/**
 * A card grid's column count. Auto columns are chosen from the card count, the
 * Event Canvas inside the Screen inset, and for a Fixed grid its card width and
 * gap, never from the rendered page: a settings editor reads the same inputs
 * its Screen Output does, so both count the same pages (ADR-0053).
 */
export function useCardGridColumns<M extends CardGridMode>(options: CardGridColumnsOptions<M>): ComputedRef<number> {
	const { screen, themeTokens, eventCanvas } = useScreenContext();

	return computed(() => {
		if (!options.autoColumns())
			return options.columns();

		const theme = themeTokens?.value ?? DEFAULT_THEME_TOKENS;
		const overrides = screen.value?.themeOverrides ?? {};
		const canvas = eventCanvas?.value ?? DEFAULT_EVENT_CANVAS;
		const { inset } = screenLayoutTokens(theme, overrides);
		const tokens = screenModeDimensionTokens(options.mode, [options.cardWidthToken, options.gapToken], theme, overrides);
		const width = canvas.width - 2 * inset;
		const gap = tokens[options.gapToken];

		return options.sizing() === 'fit'
			? fitColumns({ count: options.count(), width, height: canvas.height - 2 * inset, gap })
			: fixedColumns({ width, cardWidth: tokens[options.cardWidthToken], gap });
	});
}
