import type { SwapFeatureMatchSeatsInput } from '~~/shared/api';
import type { Seat } from '~~/shared/types/enums';
import type {
	CreateFeatureMatchInput,
	FeatureMatch,
	FeatureMatchNoteDiscardConfirmation,
	FeatureMatchPromotionResponse,
	UpdateFeatureMatchInput,
} from '~/types';
import { useEventDataFetch, useEventDataResource } from '~/modules/event-data/client';

export interface FeatureMatchSlotReorderAnswer {
	slots: { matchId: number; sortOrder: number }[];
}

export function useFeatureMatchRepository() {
	const base = useEventDataResource<FeatureMatch, CreateFeatureMatchInput, UpdateFeatureMatchInput>({
		resourcePath: 'feature-match-slots',
		eventScoped: true,
		includeHeaders: true,
		responseKey: 'featureMatchSlots',
	});
	const eventData = useEventDataFetch();

	const update = async (eventId: number, slotId: number, updates: UpdateFeatureMatchInput): Promise<FeatureMatch> => {
		return await eventData.command<FeatureMatch, UpdateFeatureMatchInput>(
			{
				eventId,
				resourcePath: 'feature-match-slots',
				resourceId: slotId,
				suffix: 'setup',
			},
			{ method: 'PATCH', body: updates },
		);
	};

	/** Answers every Slot whose order the reorder changed, with its new order. */
	const reorder = async (eventId: number, slotId: number, direction: 'up' | 'down'): Promise<FeatureMatchSlotReorderAnswer> => {
		return await eventData.command<FeatureMatchSlotReorderAnswer, { slotId: number; direction: 'up' | 'down' }>(
			{ eventId, resourcePath: 'feature-match-slots', suffix: 'reorder' },
			{
				method: 'PATCH',
				body: { slotId, direction },
			},
		);
	};

	/** Swap Seats: two Seats' players change places in a Commander Slot itself (ADR-0086). Answers the Slot. */
	const swapSeats = async (eventId: number, slotId: number, seats: [Seat, Seat]): Promise<FeatureMatch> => {
		return await eventData.command<FeatureMatch, SwapFeatureMatchSeatsInput>(
			{
				eventId,
				resourcePath: 'feature-match-slots',
				resourceId: slotId,
				suffix: 'swap-seats',
			},
			{
				method: 'POST',
				body: { seats },
			},
		);
	};

	const promoteMatch = async (
		eventId: number,
		slotId: number,
		matchId: number,
		confirmedNoteDiscards?: FeatureMatchNoteDiscardConfirmation[],
	): Promise<FeatureMatchPromotionResponse> => {
		return await eventData.command<FeatureMatchPromotionResponse, { matchId: number; confirmedNoteDiscards?: FeatureMatchNoteDiscardConfirmation[] }>(
			{
				eventId,
				resourcePath: 'feature-match-slots',
				resourceId: slotId,
				suffix: 'promote',
			},
			{
				method: 'POST',
				body: {
					matchId,
					...(confirmedNoteDiscards
						? { confirmedNoteDiscards }
						: {}),
				},
			},
		);
	};

	return {
		list: base.list,
		getById: base.getById,
		create: base.create,
		update,
		remove: base.remove,
		reorder,
		swapSeats,
		promoteMatch,
	};
}
