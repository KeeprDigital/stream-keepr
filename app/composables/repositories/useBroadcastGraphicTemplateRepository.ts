import type { ScreenResponse } from '~~/shared/api';
import type {
	BroadcastGraphicTemplateListResponse,
	BroadcastGraphicTemplateResponse,
	BroadcastGraphicTemplateSummary,
} from '~~/shared/types/broadcastGraphicTemplate';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';

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
	/**
	 * Importing a Template Package is a Graphics Ingestion Operation, so it runs on
	 * the Graphics Asset Library's own durable path rather than on the template
	 * library's. That is the artifact boundary again: receiving, validating, and
	 * installing bytes belongs to the asset library, and only the design that comes
	 * out the other end belongs here.
	 */
	const ingestion = '/api/graphics-assets/ingestion-operations';
	const ingestionTransfer = useGraphicsIngestionTransfer();

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
	 * `revision` is the revision the caller read, and it is required: the write is
	 * refused if the template has moved on since, rather than last-write-wins.
	 */
	const update = async (
		templateId: string,
		patch: {
			name?: string;
			description?: string | null;
			document?: BroadcastGraphicConfig;
			revision: number;
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
		/** The Screen version the placement was built against; required by the route. */
		stateVersion: number;
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

	/**
	 * Where one template's `.skgraphic` Template Package is served from.
	 *
	 * A URL rather than a fetch, because the browser downloading it directly is the
	 * whole point: a package is a file an author keeps, and pulling megabytes of
	 * embedded assets through JavaScript to hand them straight back to a download
	 * would buffer the entire archive in the tab for no gain.
	 */
	const packageUrl = (templateId: string): string => `${library}/${templateId}/template-package`;

	/**
	 * Receive one `.skgraphic` Template Package and run it through preflight.
	 *
	 * Import is a Graphics Ingestion Operation, so it is the operation that comes
	 * back rather than a template: preflight may reject it, or pause it once for a
	 * confirmation, and only a caller looking at the operation can tell which.
	 *
	 * A package is an envelope holding whole Graphic Assets, so it is routinely
	 * longer than any single transfer request may carry. The bytes therefore go
	 * through the shared ingestion transfer, which sends a large archive as a
	 * resumable multipart transfer rather than refusing it.
	 */
	const receivePackage = async (file: File): Promise<GraphicsIngestionOperation> => {
		const initiated = await $fetch<GraphicsIngestionOperation>(ingestion, {
			method: 'POST',
			headers: apiHeaders.getHeaders(),
			body: {
				idempotencyKey: `skgraphic-import-${crypto.randomUUID()}`,
				source: 'template-package',
				sourceFileName: file.name,
				declaredByteLength: file.size,
			},
		});
		return await ingestionTransfer.transfer(initiated, file);
	};

	/**
	 * Accept one exact preflight proposal. The fingerprint is what is being accepted,
	 * not the operation: a report that has since changed is a different proposal and
	 * this confirmation does not carry over to it.
	 */
	const confirmPackage = async (
		operationId: string,
		fingerprint: string,
	): Promise<GraphicsIngestionOperation> => {
		return await $fetch<GraphicsIngestionOperation>(
			`${ingestion}/${operationId}/template-package-confirmation`,
			{ method: 'POST', headers: apiHeaders.getHeaders(), body: { fingerprint } },
		);
	};

	/** Install a confirmed package. Repeating it answers with the installation that committed. */
	const installPackage = async (operationId: string): Promise<GraphicsIngestionOperation> => {
		return await $fetch<GraphicsIngestionOperation>(
			`${ingestion}/${operationId}/template-package-installation`,
			{ method: 'POST', headers: apiHeaders.getHeaders() },
		);
	};

	return {
		list,
		get,
		save,
		update,
		remove,
		place,
		packageUrl,
		receivePackage,
		confirmPackage,
		installPackage,
	};
}
