import type { CardSizing } from '~~/shared/types/enums';
import { DEFAULT_EVENT_CANVAS } from '~~/shared/eventCanvas';
import { DEFAULT_THEME_TOKENS } from '~~/shared/modules/theme';
import { fitColumns, fixedColumns } from '~~/shared/utils/cardGrid';
import { screenLayoutTokens } from '~/modules/screen-mode';

export interface CardGridColumnsOptions {
	sizing: () => CardSizing;
	autoColumns: () => boolean;
	/** The operator's column count, which auto columns replaces. */
	columns: () => number;
	/** The cards the grid lays out, across every page. */
	count: () => number;
	/** A paged grid's rows a page, which Fit columns are chosen to fill. */
	maxRows?: () => number;
	/** A Fixed card's width and the grid's gap, in Event Canvas px. */
	cardWidth: () => number;
	gap: () => number;
}

/**
 * A card grid's column count. Auto columns are chosen from the card count, the
 * Event Canvas inside the Screen inset, and for a Fixed grid its card width and
 * gap, never from the rendered page: a settings editor reads the same inputs
 * its Screen Output does, so both count the same pages (ADR-0053).
 */
export function useCardGridColumns(options: CardGridColumnsOptions): ComputedRef<number> {
	const { screen, themeTokens, eventCanvas } = useScreenContext();

	return computed(() => {
		if (!options.autoColumns())
			return options.columns();

		const canvas = eventCanvas?.value ?? DEFAULT_EVENT_CANVAS;
		const { inset } = screenLayoutTokens(themeTokens?.value ?? DEFAULT_THEME_TOKENS, screen.value?.themeOverrides ?? {});
		const width = canvas.width - 2 * inset;
		const gap = options.gap();

		return options.sizing() === 'fit'
			? fitColumns({
					count: options.count(),
					width,
					height: canvas.height - 2 * inset,
					gap,
					maxRows: options.maxRows?.(),
				})
			: fixedColumns({
					width,
					cardWidth: options.cardWidth(),
					gap,
				});
	});
}
