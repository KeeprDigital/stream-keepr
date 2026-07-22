import type {
	CreateScreenInput,
	Screen,
	UpdateScreenInput,
} from '~/types';
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

	const getBySlug = async (eventId: number, slug: string): Promise<Screen | null> => {
		try {
			return await $fetch<Screen>(`/api/events/${eventId}/screens/slug/${slug}`);
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
