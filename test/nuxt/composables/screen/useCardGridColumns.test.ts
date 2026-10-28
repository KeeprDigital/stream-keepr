import type { ScreenContext } from '~/composables/screen/useScreenContext';
import type { CardSizing } from '~~/shared/types/enums';
import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import { useCardGridColumns } from '~/composables/screen/useCardGridColumns';
import { useEditedScreenModeData } from '~/modules/screen-mode/editorModeData';
import { fitColumns } from '~~/shared/utils/cardGrid';
import { createMockScreen } from '~~/test/helpers/fixtures';

interface Case {
	sizing: CardSizing;
	autoColumns: boolean;
	count?: number;
	canvas?: { width: number; height: number };
	overrides?: Record<string, unknown>;
}

function columnsIn({ sizing, autoColumns, count = 10, canvas, overrides = {} }: Case): number {
	const context: ScreenContext = {
		screen: ref(createMockScreen({ themeOverrides: overrides } as any) as any),
		eventId: computed(() => 1),
		interactive: ref(false),
		overlayContainer: ref(null),
		...(canvas ? { eventCanvas: ref(canvas) } : {}),
	};
	return runInScreenContext(context, () => useCardGridColumns({
		mode: 'top-cards',
		sizing: () => sizing,
		autoColumns: () => autoColumns,
		columns: () => 5,
		count: () => count,
		cardWidthToken: 'card-width',
		gapToken: 'card-gap',
	})).value;
}

describe('useCardGridColumns', () => {
	it.each([
		{ name: 'auto off keeps the configured columns', sizing: 'fit', autoColumns: false, expected: 5 },
		{ name: 'Fit fills the default canvas', sizing: 'fit', autoColumns: true, expected: fitColumns({ count: 10, width: 1920, height: 1080, gap: 12 }) },
		{ name: 'Fixed fits default-width cards across', sizing: 'fixed', autoColumns: true, expected: 11 },
		{ name: 'Fixed fits fewer inside a Screen inset', sizing: 'fixed', autoColumns: true, overrides: { inset: 96 }, expected: 10 },
		{ name: 'Fixed fits fewer of a Screen\'s wider cards', sizing: 'fixed', autoColumns: true, overrides: { 'top-cards.card-width': 480 }, expected: 3 },
		{ name: 'Fit takes fewer columns on a portrait canvas', sizing: 'fit', autoColumns: true, canvas: { width: 1080, height: 1920 }, expected: fitColumns({ count: 10, width: 1080, height: 1920, gap: 12 }) },
	] satisfies (Case & { name: string; expected: number })[])('$name', ({ expected, ...input }) => {
		expect(columnsIn(input)).toBe(expected);
	});

	it('reads the edited Event\'s canvas in a settings editor, as its Screen Output does', () => {
		setActivePinia(createPinia());
		const eventStore = useEventStore();
		eventStore.event = { id: 1, canvasWidth: 1080, canvasHeight: 1920 } as any;

		const columns = useEditedScreenModeData({
			screen: () => createMockScreen() as any,
			eventId: () => 1,
			saving: () => false,
		}, () => useCardGridColumns({
			mode: 'top-cards',
			sizing: () => 'fit',
			autoColumns: () => true,
			columns: () => 5,
			count: () => 10,
			cardWidthToken: 'card-width',
			gapToken: 'card-gap',
		}));

		expect(columns.value).toBe(fitColumns({ count: 10, width: 1080, height: 1920, gap: 12 }));
	});
});
