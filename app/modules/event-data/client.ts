import { useApiHeaders } from '~/composables/core/useApiHeaders';

export interface BaseRepositoryOptions {
	resourcePath: string;
	eventScoped?: boolean;
	includeHeaders?: boolean;
	/**
	 * Key to read the items array from in the API response (e.g. 'featureMatches').
	 * If omitted, auto-detects from 'items', resourcePath, or 'data'.
	 */
	responseKey?: string;
}

export interface ListResponse<T> {
	items?: T[];
	total?: number;
}

export interface EventDataPathOptions {
	eventId?: number | null;
	resourcePath: string;
	resourceId?: number | string;
	suffix?: string;
	eventScoped?: boolean;
}

export function buildEventDataPath(options: EventDataPathOptions): string {
	const eventScoped = options.eventScoped ?? true;
	const segments: Array<string | number> = eventScoped
		? ['api', 'events', options.eventId ?? '', options.resourcePath]
		: ['api', options.resourcePath];

	if (options.resourceId !== undefined)
		segments.push(options.resourceId);
	if (options.suffix)
		segments.push(...options.suffix.split('/').filter(Boolean));

	return `/${segments.map(segment => encodeURIComponent(String(segment))).join('/')}`;
}

export function useEventDataFetch() {
	const headers = useApiHeaders();

	function withOriginHeaders<const T extends Record<string, unknown>>(options: T = {} as T): T & { headers: HeadersInit } {
		return {
			...options,
			headers: {
				...headers.getHeaders(),
				...(options.headers ?? {}),
			},
		} as T & { headers: HeadersInit };
	}

	async function command<TResponse, TBody extends object = Record<string, unknown>>(
		pathOptions: EventDataPathOptions,
		options: {
			method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
			body?: TBody;
			query?: Record<string, unknown>;
			includeHeaders?: boolean;
		},
	): Promise<TResponse> {
		const fetchOptions = {
			method: options.method,
			...(options.body !== undefined ? { body: options.body } : {}),
			...(options.query !== undefined ? { query: options.query } : {}),
		};
		return await $fetch<TResponse>(
			buildEventDataPath(pathOptions),
			options.includeHeaders === false ? fetchOptions : withOriginHeaders(fetchOptions),
		) as TResponse;
	}

	return {
		path: buildEventDataPath,
		command,
		getHeaders: headers.getHeaders,
		withOriginHeaders,
	};
}

/**
 * Event Data client seam.
 *
 * Event-scoped repositories should be thin adapters over this module while the
 * deeper Event Data module grows to own paths, realtime-origin headers,
 * response normalization, and common error modes.
 */
export function normalizeEventDataListResponse<T>(
	response: T[] | ListResponse<T> | Record<string, unknown> | null | undefined,
	options: Pick<BaseRepositoryOptions, 'resourcePath' | 'responseKey'>,
): T[] {
	if (Array.isArray(response))
		return response;

	if (response && typeof response === 'object') {
		const possibleKeys = options.responseKey
			? [options.responseKey]
			: ['items', options.resourcePath, 'data'];

		for (const key of possibleKeys) {
			const value = (response as Record<string, unknown>)[key];
			if (Array.isArray(value))
				return value as T[];
		}
	}

	return [];
}

export function isEventDataNotFoundError(err: unknown): boolean {
	const httpErr = err as { statusCode?: number; status?: number };
	return httpErr?.statusCode === 404 || httpErr?.status === 404;
}

/**
 * Event Data client seam.
 *
 * Owns Event-scoped HTTP paths, realtime-origin headers, list response
 * normalization, and common 404 behaviour for resource reads.
 */
export function useEventDataResource<
	T,
	TCreate extends object = Record<string, unknown>,
	TUpdate extends object = Record<string, unknown>,
>(options: BaseRepositoryOptions) {
	const { resourcePath, eventScoped = true, includeHeaders = false, responseKey } = options;
	const eventData = useEventDataFetch();

	function path(eventId: number | null, resourceId?: number): string {
		return buildEventDataPath({
			eventId,
			resourcePath,
			resourceId,
			eventScoped,
		});
	}

	const list = async (eventId: number | null = null): Promise<T[]> => {
		const response = await $fetch<T[] | ListResponse<T> | Record<string, unknown>>(path(eventId));
		return normalizeEventDataListResponse<T>(response, { resourcePath, responseKey });
	};

	const getById = async (eventId: number | null, resourceId: number): Promise<T | null> => {
		try {
			return await $fetch<T>(path(eventId, resourceId)) as T;
		}
		catch (err: unknown) {
			if (isEventDataNotFoundError(err))
				return null;
			throw err;
		}
	};

	const writeOptions = <TBody extends object>(method: 'POST' | 'PATCH' | 'DELETE', body?: TBody) => {
		const options = {
			method,
			...(body !== undefined ? { body } : {}),
		};
		return includeHeaders ? eventData.withOriginHeaders(options) : options;
	};

	const create = async (eventId: number | null, data: TCreate): Promise<T> => {
		return await $fetch<T>(path(eventId), writeOptions('POST', data)) as T;
	};

	const update = async (eventId: number | null, resourceId: number, data: TUpdate): Promise<T> => {
		return await $fetch<T>(path(eventId, resourceId), writeOptions('PATCH', data)) as T;
	};

	const remove = async (eventId: number | null, resourceId: number): Promise<{ success: boolean }> => {
		return await $fetch<{ success: boolean }>(path(eventId, resourceId), writeOptions('DELETE'));
	};

	return {
		list,
		getById,
		create,
		update,
		remove,
	};
}
