import type { MaybeRefOrGetter } from 'vue';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicAssetReference, GraphicAssetReferenceStatus } from '~~/shared/types/graphicsAsset';
import {
	broadcastGraphicsGraphicAssetReferences,
	graphicAssetRevisionStatusPath,
} from '~~/shared/utils/graphicsAssetReferences';
import { createGuardedSequence } from '~/utils/guardedSequence';

/**
 * Whether each Broadcast Graphic's pinned Graphic Asset Revisions resolve.
 *
 * The unit is one Broadcast Graphic, because that is what a Missing Graphic Asset
 * Reference invalidates: an operator can still take every other graphic in the
 * Screen's stack, and a Screen-wide verdict would take a whole show off air over
 * one broken sponsor logo.
 *
 * The two failures are deliberately different. A Missing Graphic Asset Reference
 * is an integrity failure — the asset or that exact revision does not exist — so
 * it never resolves by trying again and is repaired in the Edit workspace.
 * Unavailable Graphic Asset Content means the revision exists and its bytes are
 * temporarily out of reach, which is retryable, and only for an operation that
 * needs those bytes. Taking a graphic on air is such an operation: program would
 * otherwise show a graphic with a hole where its media should be.
 *
 * A graphic that pins no assets is always eligible, and never waits on a check.
 */
export type BroadcastGraphicAssetEligibility
	= | { outcome: 'eligible' }
		| { outcome: 'checking' }
		| { outcome: 'missing'; ownerSlots: string[] }
		| { outcome: 'unavailable'; ownerSlots: string[] };

function referenceKey(reference: GraphicAssetReference): string {
	return `${reference.assetId}\0${reference.revisionId}`;
}

export function useBroadcastGraphicsAssetEligibility(
	graphics: MaybeRefOrGetter<readonly BroadcastGraphicConfig[]>,
) {
	const eligibility = shallowRef(new Map<string, BroadcastGraphicAssetEligibility>());
	const statusFlights = createGuardedSequence();
	const {
		signal: referenceStatusRefreshSignal,
		requestRefresh,
	} = useGraphicAssetReferenceStatusRefresh();

	/**
	 * Each graphic's own references, discovered by the same function that builds the
	 * Screen's reference index — so what is checked here is exactly what the Screen
	 * publishes, named by exactly the owner slots the index uses.
	 */
	const referencesByGraphic = computed(() => toValue(graphics).map(graphic => ({
		graphicId: graphic.id,
		references: broadcastGraphicsGraphicAssetReferences({ graphics: [graphic] }),
	})));

	watch(
		() => ({
			byGraphic: referencesByGraphic.value,
			refreshSignal: referenceStatusRefreshSignal.value,
		}),
		async ({ byGraphic }) => {
			const flight = statusFlights.begin();

			// A graphic with no assets is settled without a request, so an unrelated
			// graphic never waits on someone else's network round trip.
			const pending = byGraphic.filter(entry => entry.references.length > 0);
			eligibility.value = new Map(byGraphic.map(entry => [
				entry.graphicId,
				entry.references.length === 0
					? { outcome: 'eligible' as const }
					: { outcome: 'checking' as const },
			]));
			if (pending.length === 0)
				return;

			// One request per distinct revision, however many items pin it.
			const unique = new Map(
				pending.flatMap(entry => entry.references).map(item => [referenceKey(item.reference), item.reference]),
			);
			const statuses = new Map(await Promise.all(
				Array.from(unique, async ([key, reference]) => [
					key,
					await $fetch<GraphicAssetReferenceStatus>(graphicAssetRevisionStatusPath(reference))
						.catch((): GraphicAssetReferenceStatus => ({ outcome: 'unavailable', retryable: true })),
				] as const),
			));
			if (flight.stale)
				return;

			eligibility.value = new Map(byGraphic.map((entry): [string, BroadcastGraphicAssetEligibility] => {
				const slotsWith = (outcome: 'missing' | 'unavailable') => entry.references
					.filter(item => statuses.get(referenceKey(item.reference))?.outcome === outcome)
					.map(item => item.ownerSlot);

				// Missing wins over unavailable: repairing an integrity failure is the
				// action to take, and retrying would not help it.
				const missing = slotsWith('missing');
				if (missing.length > 0)
					return [entry.graphicId, { outcome: 'missing', ownerSlots: missing }];
				const unavailable = slotsWith('unavailable');
				if (unavailable.length > 0)
					return [entry.graphicId, { outcome: 'unavailable', ownerSlots: unavailable }];
				return [entry.graphicId, { outcome: 'eligible' }];
			}));
		},
		{ immediate: true },
	);

	onBeforeUnmount(() => {
		statusFlights.supersede();
	});

	/**
	 * A graphic nothing knows about is eligible rather than blocked: an unknown id
	 * is not evidence of a broken reference, and failing closed here would block
	 * playout on a graphic that simply has not been checked yet.
	 */
	function graphicEligibility(graphicId: string): BroadcastGraphicAssetEligibility {
		return eligibility.value.get(graphicId) ?? { outcome: 'eligible' };
	}

	/**
	 * Whether taking this graphic on air is blocked, and why.
	 *
	 * Only a resolution failure blocks. A check still in flight does not: playout is
	 * a live action, and making Take wait on a status request would make the button
	 * feel broken every time the stack changes.
	 */
	function takeBlockedReason(graphicId: string): string | undefined {
		const current = graphicEligibility(graphicId);
		if (current.outcome === 'missing') {
			return `A Graphic Asset Reference is missing at ${current.ownerSlots.join(', ')}. `
				+ 'Repair or replace it in the Edit workspace before taking this graphic on air.';
		}
		if (current.outcome === 'unavailable') {
			return `Graphic Asset Content is temporarily unavailable at ${current.ownerSlots.join(', ')}. `
				+ 'Retry before taking this graphic on air.';
		}
		return undefined;
	}

	function retryable(graphicId: string): boolean {
		return graphicEligibility(graphicId).outcome === 'unavailable';
	}

	function retry() {
		requestRefresh();
	}

	return {
		eligibility: readonly(eligibility),
		graphicEligibility,
		takeBlockedReason,
		retryable,
		retry,
	};
}
