export const GAME_SELECT_OPTIONS: { label: string; value: Game }[] = [
	{ label: 'Magic: The Gathering', value: 'mtg' },
	{ label: 'One Piece', value: 'op' },
];

/** A Magic: The Gathering Event's Variants, Two-Player first as the one an Event has unless it says otherwise (ADR-0087). */
export const VARIANT_SELECT_OPTIONS: { label: string; value: Variant }[] = [
	{ label: 'Two-Player', value: 'two-player' },
	{ label: 'Commander', value: 'commander' },
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
