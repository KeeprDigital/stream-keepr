import type { CreateFeatureMatchInput, FeatureMatchResponse } from '~~/shared/api';
import type {
	FeatureMatchSessionCommand,
	FeatureMatchSessionCommandResult,
	FeatureMatchSessionResponse,
} from '~~/shared/types/featureMatchSession';
import { $fetch } from '@nuxt/test-utils/e2e';

let nextCommandId = 0;

export function commandId(prefix: string): string {
	nextCommandId += 1;
	return `${prefix}:integration:${nextCommandId}`;
}

export function requireActiveSession(slot: FeatureMatchResponse): FeatureMatchSessionResponse {
	if (!slot.activeSession)
		throw new Error(`Feature match slot ${slot.id} does not have an active session`);
	return slot.activeSession;
}

export async function createFeatureMatchSlot(
	eventId: number,
	body: CreateFeatureMatchInput = {},
): Promise<FeatureMatchResponse> {
	return await $fetch<FeatureMatchResponse>(`/api/events/${eventId}/feature-match-slots`, {
		method: 'POST',
		body,
	});
}

export async function getFeatureMatchSlot(eventId: number, slotId: number): Promise<FeatureMatchResponse> {
	return await $fetch<FeatureMatchResponse>(`/api/events/${eventId}/feature-match-slots/${slotId}`);
}

export async function createFeatureMatchSession(eventId: number, slotId: number): Promise<FeatureMatchSessionResponse> {
	return await $fetch<FeatureMatchSessionResponse>(`/api/events/${eventId}/feature-match-slots/${slotId}/sessions`, {
		method: 'POST',
	});
}

export async function sendFeatureMatchCommand(
	eventId: number,
	sessionId: number,
	command: FeatureMatchSessionCommand,
): Promise<FeatureMatchSessionCommandResult> {
	return await $fetch<FeatureMatchSessionCommandResult>(`/api/events/${eventId}/feature-match-sessions/${sessionId}/commands`, {
		method: 'POST',
		body: command,
	});
}

export async function createCommandHarness(
	eventId: number,
	body: CreateFeatureMatchInput = {},
): Promise<{
	slot: FeatureMatchResponse;
	session: () => FeatureMatchSessionResponse;
	send: (command: FeatureMatchSessionCommand) => Promise<FeatureMatchSessionCommandResult>;
}> {
	const slot = await createFeatureMatchSlot(eventId, body);
	let activeSession = requireActiveSession(slot);

	return {
		slot,
		session: () => activeSession,
		send: async (command: FeatureMatchSessionCommand) => {
			const result = await sendFeatureMatchCommand(eventId, activeSession.id, command);
			activeSession = result.session;
			return result;
		},
	};
}
