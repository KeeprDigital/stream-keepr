import type { BroadcastGraphicTemplateResponse } from '~~/shared/types/broadcastGraphicTemplate';
import type {
	GraphicStyleEntryDeletionMode,
	GraphicStyleSetEntry,
	GraphicStyleSetListResponse,
	GraphicStyleSetPublishResponse,
	GraphicStyleSetResponse,
	GraphicStyleSetSummary,
	GraphicStyleUpdateDecision,
	GraphicStyleUpdateReview,
} from '~~/shared/types/graphicStyleSet';

/**
 * HTTP adapter for the Graphic Style Set library.
 *
 * Only paths, methods, and shapes. The split between them is the one that matters:
 * everything about a Style Set lives under `/api/graphics-style-sets`, and everything
 * about what a Style Set change does to one template lives under that template. That
 * is not a routing preference — a publish never writes a template, and a template's
 * author decides for their own template — so a route that could do both would be the
 * first place that distinction quietly disappeared.
 */
export function useGraphicStyleSetRepository() {
	const apiHeaders = useApiHeaders();
	const library = '/api/graphics-style-sets';
	const templates = '/api/graphics-templates/broadcast-graphics';

	const list = async (): Promise<GraphicStyleSetSummary[]> => {
		const response = await $fetch<GraphicStyleSetListResponse>(library);
		return response.styleSets;
	};

	const get = async (styleSetId: string): Promise<GraphicStyleSetResponse> => {
		return await $fetch<GraphicStyleSetResponse>(`${library}/${styleSetId}`);
	};

	const create = async (input: {
		name: string;
		description?: string;
		draft?: GraphicStyleSetEntry[];
	}): Promise<GraphicStyleSetResponse> => {
		return await $fetch<GraphicStyleSetResponse>(library, {
			method: 'POST',
			headers: apiHeaders.getHeaders(),
			body: input,
		});
	};

	/** Edit the working draft. `draftRevision` is the one the caller read. */
	const update = async (
		styleSetId: string,
		patch: {
			name?: string;
			description?: string | null;
			draft?: GraphicStyleSetEntry[];
			draftRevision: number;
		},
	): Promise<GraphicStyleSetResponse> => {
		return await $fetch<GraphicStyleSetResponse>(`${library}/${styleSetId}`, {
			method: 'PATCH',
			headers: apiHeaders.getHeaders(),
			body: patch,
		});
	};

	/** One atomic publish, answering with the templates it reaches and never writing them. */
	const publish = async (
		styleSetId: string,
		draftRevision: number,
	): Promise<GraphicStyleSetPublishResponse> => {
		return await $fetch<GraphicStyleSetPublishResponse>(`${library}/${styleSetId}/publish`, {
			method: 'POST',
			headers: apiHeaders.getHeaders(),
			body: { draftRevision },
		});
	};

	const deleteEntry = async (
		styleSetId: string,
		entryId: string,
		options: { mode: GraphicStyleEntryDeletionMode; replacementEntryId?: string; draftRevision: number },
	): Promise<GraphicStyleSetResponse> => {
		const response = await $fetch<{ styleSet: GraphicStyleSetResponse }>(
			`${library}/${styleSetId}/entries/${entryId}`,
			{ method: 'DELETE', headers: apiHeaders.getHeaders(), body: options },
		);
		return response.styleSet;
	};

	const remove = async (styleSetId: string, draftRevision: number): Promise<void> => {
		await $fetch(`${library}/${styleSetId}`, {
			method: 'DELETE',
			headers: apiHeaders.getHeaders(),
			body: { draftRevision },
		});
	};

	/** What a Style Set update would change in one Broadcast Graphic Template. */
	const reviewTemplateUpdate = async (templateId: string): Promise<GraphicStyleUpdateReview> => {
		return await $fetch<GraphicStyleUpdateReview>(`${templates}/${templateId}/style-update`);
	};

	const applyTemplateUpdate = async (
		templateId: string,
		input: { revision: number; decisions?: Record<string, GraphicStyleUpdateDecision> },
	): Promise<BroadcastGraphicTemplateResponse> => {
		return await $fetch<BroadcastGraphicTemplateResponse>(`${templates}/${templateId}/style-update`, {
			method: 'POST',
			headers: apiHeaders.getHeaders(),
			body: input,
		});
	};

	return {
		list,
		get,
		create,
		update,
		publish,
		deleteEntry,
		remove,
		reviewTemplateUpdate,
		applyTemplateUpdate,
	};
}
