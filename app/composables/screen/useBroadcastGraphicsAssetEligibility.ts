import type { MaybeRefOrGetter } from 'vue';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import { flattenGraphicItems } from '~~/shared/modules/graphics';
import { broadcastGraphicsGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';
import { graphicAssetReferenceStatusOrUnavailable } from '~/utils/graphicAssetReferenceStatus';
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
		| { outcome: 'missing'; items: string[] }
		| { outcome: 'unavailable'; items: string[] };

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
	 *
	 * Each reference also carries the authored label of the Graphic Item that pinned
	 * it, because an operator alert has to name something they can find on the canvas.
	 * The owner slot stays the identity used everywhere else; the label is only how it
	 * is read out.
	 */
	const referencesByGraphic = computed(() => toValue(graphics).map((graphic) => {
		const labels = new Map(
			flattenGraphicItems(graphic).map(item => [item.id, item.label] as const),
		);

		return {
			graphicId: graphic.id,
			references: broadcastGraphicsGraphicAssetReferences({ graphics: [graphic] }).map(item => ({
				...item,
				// A slot is `graphics.<graphicId>.items.…<itemId>.asset`, so the item is
				// the segment before the field. Falls back to the slot itself, because a
				// diagnosis with an awkward name still beats no diagnosis.
				itemLabel: labels.get(item.ownerSlot.split('.').at(-2) ?? '') ?? item.ownerSlot,
			})),
		};
	}));

	watch(
		() => ({
			byGraphic: referencesByGraphic.value,
			refreshSignal: referenceStatusRefreshSignal.value,
		}),
		async ({ byGraphic }) => {
			const flight = statusFlights.begin();

			// A graphic with no assets is settled without a request, so an unrelated
			// graphic never waits on someone else's network round trip.
			//
			// A graphic that already has a verdict keeps it while the new one is in
			// flight, rather than falling back to `checking`. Any edit anywhere in the
			// Screen's stack re-runs this watch, and `checking` does not block Take — so
			// resetting would hand the operator an enabled Take on a graphic already
			// known to be broken, every time somebody touched an unrelated graphic.
			const previous = eligibility.value;
			const pending = byGraphic.filter(entry => entry.references.length > 0);
			eligibility.value = new Map(byGraphic.map((entry): [string, BroadcastGraphicAssetEligibility] => {
				if (entry.references.length === 0)
					return [entry.graphicId, { outcome: 'eligible' }];
				return [entry.graphicId, previous.get(entry.graphicId) ?? { outcome: 'checking' }];
			}));
			if (pending.length === 0)
				return;

			// One request per distinct revision, however many items pin it.
			const unique = new Map(
				pending.flatMap(entry => entry.references).map(item => [referenceKey(item.reference), item.reference]),
			);
			const statuses = new Map(await Promise.all(
				Array.from(unique, async ([key, reference]) => [
					key,
					await graphicAssetReferenceStatusOrUnavailable(reference),
				] as const),
			));
			if (flight.stale)
				return;

			eligibility.value = new Map(byGraphic.map((entry): [string, BroadcastGraphicAssetEligibility] => {
				const itemsWith = (outcome: 'missing' | 'unavailable') => entry.references
					.filter(item => statuses.get(referenceKey(item.reference))?.outcome === outcome)
					.map(item => item.itemLabel);

				// Missing wins over unavailable: repairing an integrity failure is the
				// action to take, and retrying would not help it.
				const missing = itemsWith('missing');
				if (missing.length > 0)
					return [entry.graphicId, { outcome: 'missing', items: missing }];
				const unavailable = itemsWith('unavailable');
				if (unavailable.length > 0)
					return [entry.graphicId, { outcome: 'unavailable', items: unavailable }];
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
			return `The Graphic Asset for ${current.items.join(', ')} is missing. `
				+ 'Repair or replace it in the Edit workspace before taking this graphic on air.';
		}
		if (current.outcome === 'unavailable') {
			return `Graphic Asset Content for ${current.items.join(', ')} is temporarily unavailable. `
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
