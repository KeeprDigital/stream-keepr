import type { ConversionTarget } from '~~/shared/conversionTarget';
import type { MetagameScope } from '~~/shared/types/enums';
import type { MetagameSummaryResponse } from '~~/shared/types/metagame';
import { eventConversionTarget } from '~~/shared/conversionTarget';
import { buildMetagameScopeQuery, useMetagameClient } from '~/modules/metagame/client';

export const useMetagameStore = defineStore('metagame', () => {
	const metagameClient = useMetagameClient();
	const eventStore = useEventStore();

	// ── Scope state (shared across all metagame views) ──
	const scope = ref<MetagameScope>('all');
	const topN = ref<number>(8);
	const minPoints = ref<number>(9);
	const playerListId = ref<number | undefined>(undefined);

	// ── Cached data ──
	const summaryData = ref<MetagameSummaryResponse | null>(null);
	const invalidationVersion = ref(0);

	// ── Loading ──
	const loading = ref(false);
	const error = ref<string | null>(null);
	let summaryGeneration = 0;
	const activeLoads = new Set<symbol>();

	function beginLoad() {
		const token = Symbol('metagame-load');
		activeLoads.add(token);
		loading.value = true;
		error.value = null;
		return token;
	}

	function endLoad(token: symbol) {
		activeLoads.delete(token);
		loading.value = activeLoads.size > 0;
	}

	// ── Helpers ──

	function buildScopeQuery() {
		return buildMetagameScopeQuery({
			scope: scope.value,
			topN: topN.value,
			minPoints: minPoints.value,
			playerListId: playerListId.value,
		});
	}

	/** Reactive scope query params — use as fetch query for any metagame endpoint */
	const scopeQuery = computed(() => buildScopeQuery());

	/**
	 * The Event's Conversion Target (ADR-0061), spread into archetype breakdown and
	 * detail options. It is the operator's Event's, so a write shows here while it
	 * is pending and an announced change from another operator lands here too.
	 */
	const conversionQuery = computed<ConversionTarget>(() => eventConversionTarget(eventStore.event));

	function applyRemoteInvalidated() {
		summaryData.value = null;
		invalidationVersion.value++;
	}

	// ── Actions ──

	async function loadSummary(eventId: number) {
		const generation = ++summaryGeneration;
		const token = beginLoad();
		try {
			const data = await metagameClient.loadSummary(eventId, buildScopeQuery());
			if (generation === summaryGeneration)
				summaryData.value = data;
		}
		catch (e: unknown) {
			// The sentence the authority wrote about the refusal, where it wrote one.
			// This store used to discard the failure entirely and report a static line,
			// so a summary refused for a nameable reason — a scope the installation may
			// not read, a dependency that is down — said only that something failed.
			// `useMetagamePage` re-raises this string as the toast's title, so whatever
			// is written here is what an operator reads (#262's discipline, arriving
			// late; #286).
			if (generation === summaryGeneration)
				error.value = failureSentence(e) ?? 'Failed to load metagame summary';
			console.error(e);
		}
		finally {
			endLoad(token);
		}
	}

	function $reset() {
		summaryGeneration++;
		activeLoads.clear();
		scope.value = 'all';
		topN.value = 8;
		minPoints.value = 9;
		playerListId.value = undefined;
		applyRemoteInvalidated();
		loading.value = false;
		error.value = null;
	}

	return {
		// Scope
		scope,
		topN,
		minPoints,
		playerListId,
		scopeQuery,

		// Conversion target: the Event's
		conversionQuery,

		// Data
		summaryData,
		invalidationVersion,

		// State
		loading,
		error,

		// Actions
		loadSummary,
		applyRemoteInvalidated,
		$reset,
	};
});
