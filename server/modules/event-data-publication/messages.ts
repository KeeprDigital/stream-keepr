import type { DbFeatureMatchAssignment, DbFeatureMatchSession } from '~~/server/db/schema';
import type { DbFeatureMatchWithSession } from '~~/server/mappers/featureMatch';
import type { MessagePayload, MessageType } from '~~/shared/types/messages';
import { mapFeatureMatchSessionToStarted, mapFeatureMatchToResponse } from '~~/server/mappers/featureMatch';
import { mapFeatureMatchAssignmentToResponse } from '~~/server/mappers/featureMatchAssignment';

/**
 * One realtime message, decided before anything is published, so a caller can hold
 * a whole run of them as a value. Only messages that carry a payload qualify.
 */
export type EventDataMessage = {
	[T in MessageType]: MessagePayload<T> extends undefined ? never : { type: T; payload: MessagePayload<T> };
}[MessageType];

type MessageOf<T extends MessageType> = Extract<EventDataMessage, { type: T }>;

/**
 * The Feature Match messages, built without publishing: the one place their payloads
 * are shaped, for the publication module's own wrappers and for a caller that
 * decides a run of them before publishing (a Feature Match Slot Promotion).
 */
export const featureMatchMessages = {
	slotUpdated: (slot: DbFeatureMatchWithSession): MessageOf<'featureMatch:updated'> =>
		({
			type: 'featureMatch:updated',
			payload: {
				featureMatch: mapFeatureMatchToResponse(slot),
			},
		}),
	assignmentCreated: (assignment: DbFeatureMatchAssignment): MessageOf<'featureMatchAssignment:created'> =>
		({
			type: 'featureMatchAssignment:created',
			payload: {
				featureMatchAssignment: mapFeatureMatchAssignmentToResponse(assignment),
			},
		}),
	assignmentUpdated: (assignment: DbFeatureMatchAssignment): MessageOf<'featureMatchAssignment:updated'> =>
		({
			type: 'featureMatchAssignment:updated',
			payload: {
				featureMatchAssignment: mapFeatureMatchAssignmentToResponse(assignment),
			},
		}),
	assignmentDeleted: (id: number): MessageOf<'featureMatchAssignment:deleted'> =>
		({
			type: 'featureMatchAssignment:deleted',
			payload: { featureMatchAssignmentId: id },
		}),
	sessionStarted: (session: DbFeatureMatchSession): MessageOf<'featureMatchSession:eventApplied'> =>
		({
			type: 'featureMatchSession:eventApplied',
			payload: mapFeatureMatchSessionToStarted(session),
		}),
};
