import { getScreenModeSelectOptions } from '../screenModeDefinitions';
import { SCREEN_MODE_VALUES } from '../types/enums';

export const GAME_SELECT_OPTIONS: { label: string; value: Game }[] = [
	{ label: 'Magic: The Gathering', value: 'mtg' },
	{ label: 'One Piece', value: 'op' },
];

export const FEATURE_MATCH_ORIENTATION_SELECT_OPTIONS: { label: string; value: FeatureMatchOrientation }[] = [
	{ label: 'Horizontal', value: 'horizontal' },
	{ label: 'Vertical', value: 'vertical' },
];

export const RECORD_SEPARATOR_SELECT_OPTIONS: { label: string; value: RecordSeparator }[] = [
	{ label: 'Dash (3-1-0)', value: '-' },
	{ label: 'Slash (3/1/0)', value: '/' },
	{ label: 'Pipe (3 | 1 | 0)', value: ' | ' },
	{ label: 'Space (3 1 0)', value: ' ' },
];

export const POSITION_FORMAT_SELECT_OPTIONS: { label: string; value: PositionFormat }[] = [
	{ label: 'Ordinal (1st, 2nd, 3rd)', value: 'ordinal' },
	{ label: 'Number (1, 2, 3)', value: 'number' },
];

export const SCREEN_COLOR_MODE_SELECT_OPTIONS: { label: string; value: ScreenColorMode }[] = [
	{ label: 'System', value: 'system' },
	{ label: 'Light', value: 'light' },
	{ label: 'Dark', value: 'dark' },
];

const screenModeOptionMap = new Map(getScreenModeSelectOptions().map(option => [option.value, option.label]));

export const SCREEN_MODE_SELECT_OPTIONS: { label: string; value: ScreenMode }[] = SCREEN_MODE_VALUES.map(value => ({
	label: screenModeOptionMap.get(value) ?? value,
	value,
}));

export const DECK_CARD_SIZE_SELECT_OPTIONS: { label: string; value: DeckCardSize }[] = [
	{ label: 'Small', value: 'small' },
	{ label: 'Medium', value: 'medium' },
	{ label: 'Large', value: 'large' },
];

export const QUANTITY_POSITION_SELECT_OPTIONS: { label: string; value: QuantityPosition }[] = [
	{ label: 'Top Left', value: 'top-left' },
	{ label: 'Top Center', value: 'top-center' },
	{ label: 'Top Right', value: 'top-right' },
	{ label: 'Left Center', value: 'left-center' },
	{ label: 'Right Center', value: 'right-center' },
	{ label: 'Bottom Left', value: 'bottom-left' },
	{ label: 'Bottom Center', value: 'bottom-center' },
	{ label: 'Bottom Right', value: 'bottom-right' },
];

export const QUANTITY_SIZE_SELECT_OPTIONS: { label: string; value: QuantitySize }[] = [
	{ label: 'Small', value: 'small' },
	{ label: 'Medium', value: 'medium' },
	{ label: 'Large', value: 'large' },
];

export const DECK_BOARD_VIEW_SELECT_OPTIONS: { label: string; value: DeckBoardView }[] = [
	{ label: 'Grid', value: 'grid' },
	{ label: 'Stack (overlapping)', value: 'stack' },
	{ label: 'List', value: 'list' },
];

export const SIDEBOARD_PLACEMENT_SELECT_OPTIONS: { label: string; value: SideboardPlacement }[] = [
	{ label: 'Beside the mainboard', value: 'beside' },
	{ label: 'Below the mainboard', value: 'below' },
];

export const CARD_ANIMATION_SPEED_SELECT_OPTIONS: { label: string; value: CardAnimationSpeed }[] = [
	{ label: 'Slow', value: 'slow' },
	{ label: 'Normal', value: 'normal' },
	{ label: 'Fast', value: 'fast' },
];

export const HORIZONTAL_ALIGN_SELECT_OPTIONS: { label: string; value: HorizontalAlign }[] = [
	{ label: 'Left', value: 'left' },
	{ label: 'Center', value: 'center' },
	{ label: 'Right', value: 'right' },
];

export const VERTICAL_ALIGN_SELECT_OPTIONS: { label: string; value: VerticalAlign }[] = [
	{ label: 'Top', value: 'top' },
	{ label: 'Center', value: 'center' },
	{ label: 'Bottom', value: 'bottom' },
];
