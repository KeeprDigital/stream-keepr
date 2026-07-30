import type { ScreenResponse } from '~~/shared/api';
import type {
	BroadcastGraphicsCommand,
	BroadcastGraphicsCommandResult,
	BroadcastGraphicsLiveSessionResponse,
} from '~~/shared/types/broadcastGraphicsLiveSession';
import type { ScreenMode } from '~~/shared/types/enums';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { $fetch } from '@nuxt/test-utils/e2e';

let nextCommandId = 0;

export function playoutCommandId(prefix: string): string {
	nextCommandId += 1;
	return `${prefix}:integration:${nextCommandId}`;
}

/** A minimal but renderable Broadcast Graphic: one opaque Shape Graphic Item. */
export function integrationBroadcastGraphic(id: string): BroadcastGraphicConfig {
	return {
		id,
		name: `Graphic ${id}`,
		items: [{
			id: `${id}-shape`,
			label: 'Panel',
			type: 'shape',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 400,
			height: 200,
			geometry: { cornerRadius: 0 },
			surfaceStyle: { fill: '#101014', fillOpacity: 1 },
		}],
	};
}

export async function createBroadcastGraphicsScreen(
	eventId: number,
	slug: string,
	graphics: BroadcastGraphicConfig[],
): Promise<ScreenResponse> {
	return await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
		method: 'POST',
		body: {
			name: `Broadcast Graphics ${slug}`,
			slug,
			currentMode: 'broadcast-graphics',
			modeConfigs: { 'broadcast-graphics': { graphics } },
		},
	});
}

export async function setScreenMode(
	eventId: number,
	screenId: number,
	currentMode: ScreenMode,
): Promise<ScreenResponse> {
	const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);

	return await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`, {
		method: 'PATCH',
		body: { currentMode, stateVersion: screen.stateVersion },
	});
}

export async function getBroadcastGraphicsLiveSession(
	eventId: number,
	screenId: number,
): Promise<BroadcastGraphicsLiveSessionResponse> {
	return await $fetch<BroadcastGraphicsLiveSessionResponse>(
		`/api/events/${eventId}/screens/${screenId}/broadcast-graphics/live-session`,
	);
}

export async function sendBroadcastGraphicsCommand(
	eventId: number,
	screenId: number,
	sessionId: number,
	command: BroadcastGraphicsCommand,
): Promise<BroadcastGraphicsCommandResult> {
	return await $fetch<BroadcastGraphicsCommandResult>(
		`/api/events/${eventId}/screens/${screenId}/broadcast-graphics/live-sessions/${sessionId}/commands`,
		{ method: 'POST', body: command },
	);
}

export async function createPlayoutHarness(
	eventId: number,
	slug: string,
	graphicIds: string[],
): Promise<{
	screen: ScreenResponse;
	session: () => BroadcastGraphicsLiveSessionResponse;
	reload: () => Promise<BroadcastGraphicsLiveSessionResponse>;
	send: (command: BroadcastGraphicsCommand) => Promise<BroadcastGraphicsCommandResult>;
}> {
	const screen = await createBroadcastGraphicsScreen(eventId, slug, graphicIds.map(integrationBroadcastGraphic));
	let current = await getBroadcastGraphicsLiveSession(eventId, screen.id);

	return {
		screen,
		session: () => current,
		reload: async () => {
			current = await getBroadcastGraphicsLiveSession(eventId, screen.id);
			return current;
		},
		send: async (command) => {
			const result = await sendBroadcastGraphicsCommand(eventId, screen.id, current.id, command);
			current = result.session;
			return result;
		},
	};
}
