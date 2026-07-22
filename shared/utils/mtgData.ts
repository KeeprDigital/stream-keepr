import type { MtgFormat } from '~~/shared/types/card/mtg';

export const mtgColors: {
	value: string;
	label: string;
}[] = [
	{ value: 'W', label: 'White' },
	{ value: 'U', label: 'Blue' },
	{ value: 'B', label: 'Black' },
	{ value: 'R', label: 'Red' },
	{ value: 'G', label: 'Green' },
	{ value: 'C', label: 'Colourless' },
];
export type MtgColor = (typeof mtgColors)[number]['value'];

export function mtgColorsToString(colors: MtgColor[]): string {
	return colors.join('');
}

export function mtgColorsFromString(colors: string): MtgColor[] {
	return colors.split('').map(color => color);
}

export const mtgSets: {
	value: MtgFormat;
	label: string;
}[] = [
	{ value: 'all', label: 'All' },
	{ value: 'standard', label: 'Standard' },
	{ value: 'pioneer', label: 'Pioneer' },
	{ value: 'modern', label: 'Modern' },
	{ value: 'legacy', label: 'Legacy' },
	{ value: 'pauper', label: 'Pauper' },
	{ value: 'vintage', label: 'Vintage' },
	{ value: 'commander', label: 'Commander' },
	{ value: 'token', label: 'Token' },
] as const;

export type MtgCardDisplayMode = 'preview' | 'output' | 'list' | 'history';

export const mtgCardDisplayModes: Record<MtgCardDisplayMode, {
	animated: boolean;
	turnoverable: boolean;
	selectable: boolean;
	rotatable: boolean;
	counterRotatable: boolean;
}> = {
	preview: {
		animated: true,
		turnoverable: false,
		selectable: false,
		rotatable: true,
		counterRotatable: true,
	},
	output: {
		animated: true,
		turnoverable: false,
		selectable: false,
		rotatable: true,
		counterRotatable: true,
	},
	list: {
		animated: true,
		turnoverable: true,
		selectable: true,
		rotatable: false,
		counterRotatable: false,
	},
	history: {
		animated: false,
		turnoverable: false,
		selectable: true,
		rotatable: false,
		counterRotatable: false,
	},
};
