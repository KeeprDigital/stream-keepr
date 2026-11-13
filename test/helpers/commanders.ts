import type { ManualPlayerSlotData } from '~~/shared/api';
import type { Commander } from '~~/shared/types/game';

/** Commanders as a Seat holds them (ADR-0087): each one printing of a card. */

export const ATRAXA: Commander = {
	scryfallId: 'd0d33d52-3d28-4635-b985-51e126289259',
	name: 'Atraxa, Praetors\' Voice',
	colorIdentity: 'WUBG',
	setCode: 'cm2',
	collectorNumber: '10',
};

export const TYMNA: Commander = {
	scryfallId: '4f4c5c6b-0a43-4d3c-8f0c-0f2f3a1f2c11',
	name: 'Tymna the Weaver',
	colorIdentity: 'WB',
	setCode: 'c16',
	collectorNumber: '48',
};

export const KRAUM: Commander = {
	scryfallId: '9c4d7a1e-5b0f-4a3e-9d57-6f6d6d0b7a22',
	name: 'Kraum, Ludevic\'s Opus',
	colorIdentity: 'UR',
	setCode: 'c16',
	collectorNumber: '34',
};

/** A typed Seat as a setup save sends it: a name, its Commanders, and whatever else `extra` holds. */
export function typedSeat(name: string, commanders: Commander[], extra: Partial<ManualPlayerSlotData> = {}): ManualPlayerSlotData {
	return {
		name,
		...extra,
		gameData: { type: 'mtg', commanders },
	};
}

/** The Scryfall card a Commander is picked from, as its search answers it. */
export function scryfallCardOf(commander: Commander, overrides: Record<string, unknown> = {}) {
	return {
		id: commander.scryfallId,
		name: commander.name,
		// Scryfall lists a colour identity alphabetically.
		color_identity: [...commander.colorIdentity].sort(),
		set: commander.setCode,
		collector_number: commander.collectorNumber,
		...overrides,
	};
}
