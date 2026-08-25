import type { DbBroadcastDeckList, DbBroadcastDeckListEntry } from '~~/server/db/schema';
import type { BroadcastDeckListResponse, BroadcastDeckListSummaryResponse } from '~~/shared/types/broadcastDeckList';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export interface BroadcastDeckListAggregate extends DbBroadcastDeckList {
	entries: DbBroadcastDeckListEntry[];
}

export interface BroadcastDeckListSummaryRow extends DbBroadcastDeckList {
	mainboardQuantity: number;
	sideboardQuantity: number;
	hasCompanion: boolean;
}

function publicListFields(list: DbBroadcastDeckList) {
	const {
		normalizedName: _,
		operationVersion: __,
		sourceText: ___,
		...fields
	} = list;
	return mapTimestamps(fields);
}

export function mapBroadcastDeckListSummary(list: BroadcastDeckListSummaryRow): BroadcastDeckListSummaryResponse {
	return {
		...publicListFields(list),
		mainboardQuantity: Number(list.mainboardQuantity),
		sideboardQuantity: Number(list.sideboardQuantity),
		hasCompanion: Boolean(list.hasCompanion),
	};
}

export function mapBroadcastDeckListDetail(list: BroadcastDeckListAggregate): BroadcastDeckListResponse {
	const mainboardQuantity = list.entries
		.filter(entry => entry.compartment === 'mainboard')
		.reduce((total, entry) => total + entry.quantity, 0);
	const sideboardQuantity = list.entries
		.filter(entry => entry.compartment === 'sideboard')
		.reduce((total, entry) => total + entry.quantity, 0);

	return {
		...publicListFields(list),
		sourceText: list.sourceText,
		mainboardQuantity,
		sideboardQuantity,
		hasCompanion: list.entries.some(entry => entry.compartment === 'companion'),
		entries: list.entries.map((entry) => {
			const { createdAt: _, updatedAt: __, ...publicEntry } = entry;
			return publicEntry;
		}),
	};
}
