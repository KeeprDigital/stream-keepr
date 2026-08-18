import type {
	CreateScreenInput,
	Screen,
	UpdateScreenInput,
} from '~/types';
import { screenOutputCapabilityHeaders } from '~~/shared/utils/screenOutput';
import { useEventDataFetch, useEventDataResource } from '~/modules/event-data/client';

export function useScreenRepository() {
	const base = useEventDataResource<Screen, CreateScreenInput, UpdateScreenInput>({
		resourcePath: 'screens',
		eventScoped: true,
		includeHeaders: true,
	});
	const eventData = useEventDataFetch();

	const getById = async (eventId: number, screenId: number): Promise<Screen> => {
		const screen = await base.getById(eventId, screenId);
		if (!screen) {
			throw new Error('Screen not found');
		}
		return screen;
	};

	/**
	 * The Screen behind a slug, as a Screen Output or as the operator embedding one.
	 *
	 * On the capability surface since #397, so the path is
	 * `/api/screen-output/**` and the request has to carry a credential: the
	 * capability an output holds in its URL fragment, or — for the `embed=preview`
	 * surfaces, which deliberately hold none — the operator's own session cookie,
	 * which rides along without being asked for.
	 *
	 * `assetCapability` is passed in rather than read from the route here, because a
	 * repository has no business knowing which page it is on; `displaySession.ts`
	 * has already parsed the fragment for its own use.
	 *
	 * Still null on refusal. The route answers one 404 for a missing Screen, an
	 * unknown slug and a capability for some other Screen alike, so there is nothing
	 * for a caller to tell apart — which is the posture the capability surface keeps.
	 */
	const getBySlug = async (
		eventId: number,
		slug: string,
		assetCapability?: string | null,
	): Promise<Screen | null> => {
		try {
			return await $fetch<Screen>(`/api/screen-output/events/${eventId}/screens/slug/${slug}`, {
				headers: screenOutputCapabilityHeaders(assetCapability),
			});
		}
		catch {
			return null;
		}
	};

	const updateModeConfig = async (
		eventId: number,
		screenId: number,
		mode: string,
		config: Record<string, unknown>,
		stateVersion: number = 0,
	): Promise<Screen> => {
		return await eventData.command<Screen>(
			{ eventId, resourcePath: 'screens', resourceId: screenId, suffix: `config/${mode}` },
			{ method: 'PATCH', body: { ...config, stateVersion } },
		);
	};

	const updateScreenConfig = async (
		eventId: number,
		screenId: number,
		config: Record<string, unknown>,
		stateVersion: number = 0,
	): Promise<Screen> => {
		return await eventData.command<Screen>(
			{ eventId, resourcePath: 'screens', resourceId: screenId, suffix: 'screen-config' },
			{ method: 'PATCH', body: { ...config, stateVersion } },
		);
	};

	return {
		list: base.list,
		getById,
		getBySlug,
		create: base.create,
		update: base.update,
		updateModeConfig,
		updateScreenConfig,
		remove: base.remove,
	};
}
