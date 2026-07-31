import type { ScreenResponse } from '~~/shared/api';
import type {
	FeatureMatchLayoutTemplateListResponse,
	FeatureMatchLayoutTemplateResponse,
	FeatureMatchLayoutTemplateSummary,
} from '~~/shared/types/featureMatchLayoutTemplate';
import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';

/**
 * HTTP adapter for the Feature Match Layout Template library.
 *
 * Only paths, methods, and response shapes. Note where each one lives: the library
 * is installation-scoped and sits outside `/api/events`, while placing is a write to
 * one Screen and sits on that Screen. That split is the artifact boundary — a
 * template belongs to the installation, a placed layout belongs to a Screen — and
 * keeping it visible in the URLs is what stops a template from being mistaken for
 * Event state.
 */
export function useFeatureMatchLayoutTemplateRepository() {
	const apiHeaders = useApiHeaders();
	const library = '/api/graphics-templates/feature-match-layouts';
	/**
	 * Importing a Template Package is a Graphics Ingestion Operation, so it runs on
	 * the Graphics Asset Library's own durable path rather than on this library's.
	 * That is the artifact boundary again: receiving, validating, and installing bytes
	 * belongs to the asset library, and only the layout that comes out the other end
	 * belongs here.
	 */
	const ingestion = '/api/graphics-assets/ingestion-operations';
	const ingestionTransfer = useGraphicsIngestionTransfer();

	const list = async (): Promise<FeatureMatchLayoutTemplateSummary[]> => {
		const response = await $fetch<FeatureMatchLayoutTemplateListResponse>(library);
		return response.templates;
	};

	const get = async (templateId: string): Promise<FeatureMatchLayoutTemplateResponse> => {
		return await $fetch<FeatureMatchLayoutTemplateResponse>(`${library}/${templateId}`);
	};

	/** Save one Screen's Feature Match Layout as a new template. */
	const save = async (input: {
		eventId: number;
		screenId: number;
		name?: string;
		description?: string;
	}): Promise<FeatureMatchLayoutTemplateResponse> => {
		return await $fetch<FeatureMatchLayoutTemplateResponse>(library, {
			method: 'POST',
			headers: apiHeaders.getHeaders(),
			body: {
				source: { eventId: input.eventId, screenId: input.screenId },
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
			document?: FeatureMatchLayoutConfig;
			revision: number;
		},
	): Promise<FeatureMatchLayoutTemplateResponse> => {
		return await $fetch<FeatureMatchLayoutTemplateResponse>(`${library}/${templateId}`, {
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

	/**
	 * Place a template on one Screen, replacing its whole Feature Match Layout.
	 *
	 * `stateVersion` is the Screen version the placement was built against; the route
	 * requires it so a placement built on a stale layout is refused rather than
	 * silently discarding a concurrent change.
	 */
	const place = async (input: {
		eventId: number;
		screenId: number;
		templateId: string;
		stateVersion: number;
	}): Promise<{ screen: ScreenResponse; layout: FeatureMatchLayoutConfig }> => {
		return await $fetch<{ screen: ScreenResponse; layout: FeatureMatchLayoutConfig }>(
			`/api/events/${input.eventId}/screens/${input.screenId}/feature-match-overlay/layout-placements`,
			{
				method: 'POST',
				headers: apiHeaders.getHeaders(),
				body: { templateId: input.templateId, stateVersion: input.stateVersion },
			},
		);
	};

	/**
	 * Where one template's `.sklayout` Template Package is served from.
	 *
	 * A URL rather than a fetch, because the browser downloading it directly is the
	 * whole point: a package is a file an author keeps, and pulling megabytes of
	 * embedded assets through JavaScript to hand them straight back to a download
	 * would buffer the entire archive in the tab for no gain.
	 */
	const packageUrl = (templateId: string): string => `${library}/${templateId}/template-package`;

	/**
	 * Receive one `.sklayout` Template Package and run it through preflight.
	 *
	 * Import is a Graphics Ingestion Operation, so it is the operation that comes back
	 * rather than a template: preflight may reject it, or pause it once for a
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
				idempotencyKey: `sklayout-import-${crypto.randomUUID()}`,
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
