import type { MaybeRefOrGetter } from 'vue';
import type { GraphicAssetReferenceStatus } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import {
	featureMatchOverlayGraphicAssetReferences,
	graphicAssetRevisionStatusPath,
} from '~~/shared/utils/graphicsAssetReferences';
import { createGuardedSequence } from '~/utils/guardedSequence';

export type GraphicAssetPublicationEligibility
	= | { outcome: 'eligible' }
		| { outcome: 'checking' }
		| { outcome: 'missing'; ownerSlots: string[] }
		| { outcome: 'unavailable'; ownerSlots: string[] };

export function useGraphicAssetPublicationEligibility(
	config: MaybeRefOrGetter<FeatureMatchOverlayModeConfig>,
) {
	const eligibility = ref<GraphicAssetPublicationEligibility>({ outcome: 'checking' });
	const statusFlights = createGuardedSequence();
	const refreshRequest = ref(0);

	watch(
		() => ({
			references: featureMatchOverlayGraphicAssetReferences(toValue(config)),
			refreshRequest: refreshRequest.value,
		}),
		async ({ references }) => {
			const flight = statusFlights.begin();
			if (references.length === 0) {
				eligibility.value = { outcome: 'eligible' };
				return;
			}

			eligibility.value = { outcome: 'checking' };
			const statuses = await Promise.all(references.map(async item => ({
				ownerSlot: item.ownerSlot,
				status: await $fetch<GraphicAssetReferenceStatus>(
					graphicAssetRevisionStatusPath(item.reference),
				).catch((): GraphicAssetReferenceStatus => ({
					outcome: 'unavailable',
					retryable: true,
				})),
			})));
			if (flight.stale)
				return;

			const missing = statuses
				.filter(item => item.status.outcome === 'missing')
				.map(item => item.ownerSlot);
			if (missing.length > 0) {
				eligibility.value = { outcome: 'missing', ownerSlots: missing };
				return;
			}
			const unavailable = statuses
				.filter(item => item.status.outcome === 'unavailable')
				.map(item => item.ownerSlot);
			eligibility.value = unavailable.length > 0
				? { outcome: 'unavailable', ownerSlots: unavailable }
				: { outcome: 'eligible' };
		},
		{ immediate: true },
	);

	function retry() {
		refreshRequest.value += 1;
	}

	const blocked = computed(() => eligibility.value.outcome !== 'eligible');
	const reason = computed(() => {
		switch (eligibility.value.outcome) {
			case 'checking':
				return 'Checking exact Graphic Asset Revisions before enabling output actions.';
			case 'missing':
				return 'A referenced Graphic Asset or exact revision is missing. Repair or replace it before using output actions.';
			case 'unavailable':
				return 'Referenced Graphic Asset Content is temporarily unavailable. Retry before using output actions.';
			case 'eligible':
				return undefined;
		}
	});

	return {
		eligibility: readonly(eligibility),
		blocked,
		reason,
		retry,
	};
}
