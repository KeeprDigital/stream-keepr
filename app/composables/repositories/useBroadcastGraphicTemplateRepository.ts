import type { ScreenResponse } from '~~/shared/api';
import type {
	BroadcastGraphicTemplateListResponse,
	BroadcastGraphicTemplateResponse,
	BroadcastGraphicTemplateSummary,
} from '~~/shared/types/broadcastGraphicTemplate';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';

/**
 * HTTP adapter for the Broadcast Graphic Template library.
 *
 * Only paths, methods, and response shapes. Note where each one lives: the library
 * is installation-scoped and sits outside `/api/events`, while placement is a write
 * to one Screen and sits on that Screen. That split is the artifact boundary — a
 * template belongs to the installation, a placed copy belongs to a Screen — and
 * keeping it visible in the URLs is what stops a template from ever being mistaken
 * for Event state.
 */
export function useBroadcastGraphicTemplateRepository() {
	const apiHeaders = useApiHeaders();
	const library = '/api/graphics-templates/broadcast-graphics';

	const list = async (): Promise<BroadcastGraphicTemplateSummary[]> => {
		const response = await $fetch<BroadcastGraphicTemplateListResponse>(library);
		return response.templates;
	};

	const get = async (templateId: string): Promise<BroadcastGraphicTemplateResponse> => {
		return await $fetch<BroadcastGraphicTemplateResponse>(`${library}/${templateId}`);
	};

	/** Save one placed Broadcast Graphic as a new template. */
	const save = async (input: {
		eventId: number;
		screenId: number;
		graphicId: string;
		name?: string;
		description?: string;
	}): Promise<BroadcastGraphicTemplateResponse> => {
		return await $fetch<BroadcastGraphicTemplateResponse>(library, {
			method: 'POST',
			headers: apiHeaders.getHeaders(),
			body: {
				source: { eventId: input.eventId, screenId: input.screenId, graphicId: input.graphicId },
				name: input.name,
				description: input.description,
			},
		});
	};

	/**
	 * `revision` is the revision the caller read, and the write is refused if the
	 * template has moved on since — compare-and-swap rather than last-write-wins.
	 */
	const update = async (
		templateId: string,
		patch: {
			name?: string;
			description?: string | null;
			document?: BroadcastGraphicConfig;
			revision?: number;
		},
	): Promise<BroadcastGraphicTemplateResponse> => {
		return await $fetch<BroadcastGraphicTemplateResponse>(`${library}/${templateId}`, {
			method: 'PATCH',
			headers: apiHeaders.getHeaders(),
			body: patch,
		});
	};

	const remove = async (templateId: string): Promise<void> => {
		await $fetch(`${library}/${templateId}`, {
			method: 'DELETE',
			headers: apiHeaders.getHeaders(),
		});
	};

	/** Place a template on one Screen as an independent copy. */
	const place = async (input: {
		eventId: number;
		screenId: number;
		templateId: string;
		stateVersion?: number;
	}): Promise<{ screen: ScreenResponse; graphic: BroadcastGraphicConfig }> => {
		return await $fetch<{ screen: ScreenResponse; graphic: BroadcastGraphicConfig }>(
			`/api/events/${input.eventId}/screens/${input.screenId}/broadcast-graphics/placements`,
			{
				method: 'POST',
				headers: apiHeaders.getHeaders(),
				body: { templateId: input.templateId, stateVersion: input.stateVersion },
			},
		);
	};

	return { list, get, save, update, remove, place };
}
