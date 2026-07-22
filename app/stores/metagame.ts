import type { MetagameScope } from '~~/shared/types/enums';
import type { MetagameSummaryResponse } from '~~/shared/types/metagame';
import { buildMetagameScopeQuery, useMetagameClient } from '~/modules/metagame/client';

export const useMetagameStore = defineStore('metagame', () => {
	const metagameClient = useMetagameClient();

	// ── Scope state (shared across all metagame views) ──
	const scope = ref<MetagameScope>('all');
	const topN = ref<number>(8);
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
			playerListId: playerListId.value,
		});
	}

	/** Reactive scope query params — use as fetch query for any metagame endpoint */
	const scopeQuery = computed(() => buildScopeQuery());

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
			if (generation === summaryGeneration)
				error.value = 'Failed to load metagame summary';
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
		playerListId.value = undefined;
		applyRemoteInvalidated();
		loading.value = false;
		error.value = null;
	}

	return {
		// Scope
		scope,
		topN,
		playerListId,
		scopeQuery,

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
