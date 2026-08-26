import type { AnimationEffectSelection } from '~~/shared/animationEffects';
import type {
	AnimationEffectPresetListResponse,
	AnimationEffectPresetResponse,
} from '~~/shared/types/animationEffectPreset';

/** HTTP adapter for the installation-scoped Animation Effect Preset library. */
export function useAnimationEffectPresetRepository() {
	const apiHeaders = useApiHeaders();
	const library = '/api/animation-effect-presets';

	const list = async (): Promise<AnimationEffectPresetResponse[]> => {
		const response = await $fetch<AnimationEffectPresetListResponse>(library);
		return response.presets;
	};

	const create = async (input: {
		name: string;
		selection: AnimationEffectSelection;
	}): Promise<AnimationEffectPresetResponse> => await $fetch<AnimationEffectPresetResponse>(library, {
		method: 'POST',
		headers: apiHeaders.getHeaders(),
		body: input,
	});

	const update = async (
		presetId: string,
		patch: {
			name?: string;
			selection?: AnimationEffectSelection;
			revision: number;
		},
	): Promise<AnimationEffectPresetResponse> => await $fetch<AnimationEffectPresetResponse>(
		`${library}/${presetId}`,
		{
			method: 'PATCH',
			headers: apiHeaders.getHeaders(),
			body: patch,
		},
	);

	const remove = async (presetId: string): Promise<void> => {
		await $fetch(`${library}/${presetId}`, {
			method: 'DELETE',
			headers: apiHeaders.getHeaders(),
		});
	};

	const importDocument = async (document: string): Promise<AnimationEffectPresetResponse> => {
		return await $fetch<AnimationEffectPresetResponse>(`${library}/imports`, {
			method: 'POST',
			headers: apiHeaders.getHeaders(),
			body: { document },
		});
	};

	const exportUrl = (presetId: string): string => `${library}/${presetId}/export`;

	return { list, create, update, remove, importDocument, exportUrl };
}
