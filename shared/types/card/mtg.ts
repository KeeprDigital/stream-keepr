import type { ScryfallCardFields, ScryfallImageUris } from '@scryfall/api-types';

/* TYPES */
export interface MtgCardDisplayData {
	flipped: boolean;
	rotated: boolean;
	counterRotated: boolean;
	turnedOver: boolean;
}

export interface MtgCardImageData {
	front: ScryfallImageUris | null;
	back: ScryfallImageUris | null;
}

export interface MtgCardOrientationData {
	flipable: boolean;
	turnable: boolean;
	rotateable: boolean;
	counterRotateable: boolean;
}

export interface MtgCardMeldData {
	meldPartOne: string | null;
	meldPartTwo: string | null;
	meldResult: string | null;
}

export interface MtgCardTimeoutData {
	timeoutDuration: number;
	timeoutStartTimestamp: number;
}

export interface MtgCard {
	id: string;
	name: string;
	set: string;
	layout: ScryfallCardFields.Core.All['layout'];
	imageData: MtgCardImageData;
	orientationData: MtgCardOrientationData;
	displayData: MtgCardDisplayData;
	deckCounterTypes?: string[];
	deckTokens?: {
		id: string;
		scryfallId: string | null;
		name: string;
		typeLine: string | null;
		uri: string | null;
	}[];
	meldData?: MtgCardMeldData;
	timeoutData?: MtgCardTimeoutData;
}

/* ACTION TYPES */
export type MtgPreviewCardAction
	= | 'show'
		| 'clear'
		| 'flip'
		| 'rotate'
		| 'turnOver'
		| 'counterRotate';

export type MtgActiveCardAction
	= | 'clear'
		| 'flip'
		| 'rotate'
		| 'turnOver'
		| 'counterRotate';

/* FORMAT TYPES */
export type MtgFormat
	= | 'all'
		| 'standard'
		| 'pioneer'
		| 'modern'
		| 'legacy'
		| 'vintage'
		| 'commander'
		| 'pauper'
		| 'historic'
		| 'explorer'
		| 'alchemy'
		| 'brawl'
		| 'token';
