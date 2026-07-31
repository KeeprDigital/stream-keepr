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
import type {
	GraphicStyleSetPackageInstallation,
	GraphicStyleSetPackagePreflightReport,
	GraphicStyleSetPackageResolution,
} from '~~/shared/types/graphicStyleSetPackage';

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

	/**
	 * Apply a reviewed update. Both revisions are the ones the review was read at: the
	 * server refuses the apply if either has moved on, rather than applying a Style Set
	 * revision the author never saw.
	 */
	const applyTemplateUpdate = async (
		templateId: string,
		input: {
			revision: number;
			styleSetRevision: number;
			decisions?: Record<string, GraphicStyleUpdateDecision>;
		},
	): Promise<BroadcastGraphicTemplateResponse> => {
		return await $fetch<BroadcastGraphicTemplateResponse>(`${templates}/${templateId}/style-update`, {
			method: 'POST',
			headers: apiHeaders.getHeaders(),
			body: input,
		});
	};

	/**
	 * Where one Graphic Style Set's `.skstyle` package is served from.
	 *
	 * A URL rather than a fetch, because the browser downloading it directly is the
	 * whole point: a package is a file an author keeps, and pulling it through
	 * JavaScript to hand it straight back to a download gains nothing.
	 */
	const packageUrl = (styleSetId: string): string => `${library}/${styleSetId}/package`;

	/**
	 * Inspect a received `.skstyle` package without installing anything.
	 *
	 * Safe to repeat, and the only way to learn what an install would do. The report's
	 * fingerprint is what {@link installPackage} is bound to.
	 */
	const inspectPackage = async (
		file: File,
		resolution: GraphicStyleSetPackageResolution = 'preserve-identity',
	): Promise<GraphicStyleSetPackagePreflightReport> => {
		return await $fetch<GraphicStyleSetPackagePreflightReport>(`${library}/packages/preflight`, {
			method: 'POST',
			headers: apiHeaders.getHeaders(),
			query: { resolution, sourceFileName: file.name },
			body: file,
		});
	};

	/**
	 * Install a received `.skstyle` package.
	 *
	 * The bytes travel again rather than being staged: a Style Set package is two small
	 * JSON documents, and re-deriving the report from the exact bytes being installed is
	 * a stronger guarantee than reading a stored one back. The fingerprint is what is
	 * being accepted — a report that has since changed is a different proposal, and this
	 * confirmation does not carry over to it.
	 */
	const installPackage = async (
		file: File,
		options: {
			resolution?: GraphicStyleSetPackageResolution;
			fingerprint?: string;
		} = {},
	): Promise<GraphicStyleSetPackageInstallation> => {
		return await $fetch<GraphicStyleSetPackageInstallation>(`${library}/packages`, {
			method: 'POST',
			headers: apiHeaders.getHeaders(),
			query: {
				resolution: options.resolution ?? 'preserve-identity',
				sourceFileName: file.name,
				...(options.fingerprint ? { fingerprint: options.fingerprint } : {}),
			},
			body: file,
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
		packageUrl,
		inspectPackage,
		installPackage,
	};
}
