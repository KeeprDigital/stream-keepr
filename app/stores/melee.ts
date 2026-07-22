import { isMeleeManagedRound } from '~~/shared/utils/roundControl';

export type SetupStep = 'syncing' | 'loading' | 'complete';
export type SyncStep = 'syncing' | 'standings' | 'loading' | 'complete';
type MeleeOperationStatus = 'success' | 'warning' | 'error';
type MeleeOperationKind = 'setup' | 'update' | 'event' | 'players' | 'decklists' | 'specific-round';

interface MeleeOperationResult {
	kind: MeleeOperationKind;
	status: MeleeOperationStatus;
	title: string;
	description: string;
	details?: string[];
	at: Date;
}

interface LocalProjectionRefresh {
	label: string;
	run: () => unknown | Promise<unknown>;
}

function operationErrorMessage(error: unknown): string {
	if (typeof error === 'string' && error.trim())
		return error;
	if (error instanceof Error && error.message.trim())
		return error.message;
	return 'Unknown refresh error';
}

export const useMeleeStore = defineStore('melee', () => {
	const eventStore = useEventStore();
	const roundStore = useRoundStore();
	const phaseStore = usePhaseStore();
	const playerStore = usePlayerStore();
	const playerDeckStore = usePlayerDeckStore();
	const featureMatchStore = useFeatureMatchStore();
	const matchStore = useMatchStore();
	const metagameStore = useMetagameStore();
	const { refreshMeleeStructureData } = useMeleeDataRefresh();
	const eventRepo = useEventRepository();
	const { executeAction } = useAsyncAction();

	const syncing = ref(false);
	const syncingPlayers = ref(false);
	const syncingDecklists = ref(false);
	const syncingRound = ref(false);
	const updatingFromMelee = ref(false);
	const runningSetup = ref(false);
	const setupStep = ref<SetupStep | null>(null);
	const syncStep = ref<SyncStep | null>(null);
	const error = ref<string | null>(null);
	const lastOperation = ref<MeleeOperationResult | null>(null);
	const activeCommandPromises = new Map<string, Promise<unknown>>();
	let setupStepResetTimer: ReturnType<typeof setTimeout> | null = null;
	let syncStepResetTimer: ReturnType<typeof setTimeout> | null = null;

	function runCommandOnce<T>(key: string, action: () => Promise<T>): Promise<T> {
		const active = activeCommandPromises.get(key);
		if (active)
			return active as Promise<T>;

		const promise = action();
		activeCommandPromises.set(key, promise);
		void promise.then(
			() => {
				if (activeCommandPromises.get(key) === promise)
					activeCommandPromises.delete(key);
			},
			() => {
				if (activeCommandPromises.get(key) === promise)
					activeCommandPromises.delete(key);
			},
		);
		return promise;
	}

	async function refreshLocalProjection(tasks: LocalProjectionRefresh[]): Promise<string[]> {
		const results = await Promise.allSettled(tasks.map(task => Promise.resolve().then(task.run)));
		return results.flatMap((result, index) => {
			if (result.status === 'fulfilled')
				return [];
			return [`Local ${tasks[index]!.label} refresh failed: ${operationErrorMessage(result.reason)}`];
		});
	}

	function committedOperationStatus(refreshErrors: string[]): MeleeOperationStatus {
		return refreshErrors.length > 0 ? 'warning' : 'success';
	}

	function committedOperationTitle(title: string, refreshErrors: string[]): string {
		return refreshErrors.length > 0 ? `${title} — Reload Needed` : title;
	}

	function committedOperationDescription(description: string, refreshErrors: string[]): string {
		if (refreshErrors.length === 0)
			return description;
		return `${description}. The source changes were committed, but this browser could not reload all affected data. Reload the page before retrying the sync.`;
	}

	function committedOperationDetails(details: string[], refreshErrors: string[]): string[] {
		return refreshErrors.length > 0
			? [...details, 'Source changes committed successfully.', ...refreshErrors]
			: details;
	}

	function clearSetupStepReset() {
		if (setupStepResetTimer)
			clearTimeout(setupStepResetTimer);
		setupStepResetTimer = null;
	}

	function clearSyncStepReset() {
		if (syncStepResetTimer)
			clearTimeout(syncStepResetTimer);
		syncStepResetTimer = null;
	}

	function setSetupStep(step: SetupStep | null) {
		clearSetupStepReset();
		setupStep.value = step;
	}

	function setSyncStep(step: SyncStep | null) {
		clearSyncStepReset();
		syncStep.value = step;
	}

	function completeSetupStep() {
		setSetupStep('complete');
		setupStepResetTimer = setTimeout(() => {
			if (setupStep.value === 'complete')
				setupStep.value = null;
			setupStepResetTimer = null;
		}, 1500);
	}

	function completeSyncStep() {
		setSyncStep('complete');
		syncStepResetTimer = setTimeout(() => {
			if (syncStep.value === 'complete')
				syncStep.value = null;
			syncStepResetTimer = null;
		}, 1500);
	}

	const hasCredentials = computed(() => {
		if (!eventStore.event)
			return false;
		return !!(
			eventStore.event.meleeEnabled
			&& eventStore.event.meleeConfigured
		);
	});

	/** All rounds from the DB (phases + rounds are the single source of truth). */
	const availableRounds = computed(() => roundStore.rounds.filter(round => isMeleeManagedRound(round)));

	/** The next round to sync (first round without lastSyncedAt). */
	const nextUnsyncedRound = computed(() => {
		return availableRounds.value.find(r => r.lastSyncedAt === null) ?? null;
	});

	/** Label for the sync button: "Sync Round 4" or "Sync Quarterfinals" */
	const nextRoundLabel = computed<string | null>(() => {
		const round = nextUnsyncedRound.value;
		if (!round)
			return null;
		const phase = phaseStore.getPhaseById(round.phaseId);
		const name = formatRoundOptionLabel(round, phase);
		return `Sync ${name}`;
	});

	/** True when all available rounds have been synced. */
	const allRoundsSynced = computed(() => {
		return availableRounds.value.length > 0
			&& availableRounds.value.every(r => r.lastSyncedAt !== null);
	});

	/** Number of rounds synced (have lastSyncedAt). */
	const syncedRoundCount = computed(() => {
		return availableRounds.value.filter(r => r.lastSyncedAt !== null).length;
	});

	/** Total rounds available. */
	const totalRoundCount = computed(() => availableRounds.value.length);

	function setLastOperation(result: Omit<MeleeOperationResult, 'at'>) {
		lastOperation.value = {
			...result,
			at: new Date(),
		};
	}

	async function refreshEventState(): Promise<string[]> {
		if (!eventStore.eventId)
			return [];
		const eventId = eventStore.eventId;
		return refreshLocalProjection([
			{ label: 'event status', run: () => eventStore.loadEvent(eventId) },
		]);
	}

	async function refreshLoadedMatches(eventId: number, roundIds: number[]) {
		const loadedRoundId = matchStore.loadedRoundId;
		if (loadedRoundId != null && roundIds.includes(loadedRoundId))
			await matchStore.loadMatchesByRoundId(eventId, loadedRoundId);
	}

	interface MeleeOperationStepHooks<TResponse> {
		start: () => void;
		loading: () => void;
		/** Runs after the local projection refresh, with the API response. */
		finish: (response: TResponse) => void;
		fail: () => void;
	}

	interface MeleeOperationConfig<TResponse> {
		kind: MeleeOperationKind;
		failureTitle: string;
		loadingRef: Ref<boolean>;
		/** Mirror the missing-event guard message into the shared error ref. */
		guardSetsError?: boolean;
		/** Extra pre-run guard (e.g. "already in progress"); `report` controls whether it records a failed operation. */
		precondition?: () => { error: string; report: boolean } | null;
		steps?: MeleeOperationStepHooks<TResponse>;
		apiCall: (eventId: number) => Promise<TResponse>;
		refreshTasks: (eventId: number, response: TResponse) => LocalProjectionRefresh[];
		isSuccess: (response: TResponse) => boolean;
		successContent: (response: TResponse) => { title: string; description: string; details: string[] };
		failureDescription: (response: TResponse | null) => string;
		failureDetails?: (projectionRefreshErrors: string[]) => string[];
	}

	type MeleeOperationOutcome<TResponse>
		= | { status: 'guard-failed'; error: string }
			| { status: 'success'; response: TResponse; projectionRefreshErrors: string[] }
			| { status: 'failure'; response: TResponse | null; error: string; projectionRefreshErrors: string[] };

	/**
	 * Shared skeleton for all Melee operations: missing-event guard, action
	 * execution with step indicators, local projection refresh, event-state
	 * refresh on thrown failures, and success/error `setLastOperation`.
	 */
	async function runMeleeOperation<TResponse>(config: MeleeOperationConfig<TResponse>): Promise<MeleeOperationOutcome<TResponse>> {
		if (!eventStore.eventId) {
			if (config.guardSetsError)
				error.value = 'No event loaded';
			setLastOperation({
				kind: config.kind,
				status: 'error',
				title: config.failureTitle,
				description: 'No event loaded',
			});
			return { status: 'guard-failed', error: 'No event loaded' };
		}
		const preconditionFailure = config.precondition?.() ?? null;
		if (preconditionFailure) {
			if (preconditionFailure.report) {
				setLastOperation({
					kind: config.kind,
					status: 'error',
					title: config.failureTitle,
					description: preconditionFailure.error,
				});
			}
			return { status: 'guard-failed', error: preconditionFailure.error };
		}
		const eventId = eventStore.eventId;
		let projectionRefreshErrors: string[] = [];

		const response = await executeAction(
			async () => {
				config.steps?.start();
				const response = await config.apiCall(eventId);
				config.steps?.loading();
				projectionRefreshErrors = await refreshLocalProjection(config.refreshTasks(eventId, response));
				config.steps?.finish(response);
				return response;
			},
			{
				loadingRef: config.loadingRef,
				errorRef: error,
				onError: config.steps ? () => { config.steps!.fail(); } : undefined,
			},
		);

		if (!response)
			await refreshEventState();

		if (response && config.isSuccess(response)) {
			const content = config.successContent(response);
			setLastOperation({
				kind: config.kind,
				status: committedOperationStatus(projectionRefreshErrors),
				title: committedOperationTitle(content.title, projectionRefreshErrors),
				description: committedOperationDescription(content.description, projectionRefreshErrors),
				details: committedOperationDetails(content.details, projectionRefreshErrors),
			});
			return { status: 'success', response, projectionRefreshErrors };
		}

		const failureError = config.failureDescription(response ?? null);
		setLastOperation({
			kind: config.kind,
			status: 'error',
			title: config.failureTitle,
			description: failureError,
			...(config.failureDetails ? { details: config.failureDetails(projectionRefreshErrors) } : {}),
		});
		return { status: 'failure', response: response ?? null, error: failureError, projectionRefreshErrors };
	}

	async function updateFromMeleeOnce(options: { includeDeckLists?: boolean; advanceRound?: boolean } = {}): Promise<{ success: boolean; error?: string }> {
		const outcome = await runMeleeOperation({
			kind: 'update',
			failureTitle: 'Melee Update Failed',
			loadingRef: updatingFromMelee,
			steps: {
				start: () => setSyncStep('syncing'),
				loading: () => setSyncStep('loading'),
				finish: () => completeSyncStep(),
				fail: () => setSyncStep(null),
			},
			apiCall: eventId => eventRepo.updateFromMelee(eventId, options),
			refreshTasks: eventId => [
				{ label: 'metagame cache', run: () => metagameStore.applyRemoteInvalidated() },
				{ label: 'deck cache', run: () => clearPlayerDeckCache() },
				{ label: 'event status', run: () => eventStore.loadEvent(eventId) },
				{ label: 'players', run: () => playerStore.loadPlayersByEventId(eventId) },
				{ label: 'deck lists', run: () => playerDeckStore.loadByEventId(eventId) },
				{ label: 'event structure', run: () => refreshMeleeStructureData(eventId) },
			],
			isSuccess: result => result.success,
			successContent: (result) => {
				const totalMatches = result.rounds.reduce((total, round) => total + round.matchCount, 0);
				return {
					title: 'Melee Updated',
					description: result.advancedRound
						? `${result.advancedRound.name} imported from Melee.gg`
						: 'Event data refreshed from Melee.gg',
					details: [
						`${result.players.created + result.players.updated} player change${result.players.created + result.players.updated !== 1 ? 's' : ''}`,
						...(result.deckLists ? [`${result.deckLists.deckLists} deck list${result.deckLists.deckLists !== 1 ? 's' : ''}`] : []),
						...(result.refreshedRound ? [`Refreshed ${result.refreshedRound.name}`] : []),
						...(result.advancedRound ? [`Imported ${result.advancedRound.name}`] : []),
						...(totalMatches > 0 ? [`${totalMatches} match${totalMatches !== 1 ? 'es' : ''}`] : []),
						...(result.warnings ?? []),
					],
				};
			},
			failureDescription: result => result?.message ?? error.value ?? 'Failed to update from Melee.gg',
		});

		if (outcome.status === 'success')
			return { success: true };
		return { success: false, error: outcome.error };
	}

	function updateFromMelee(options: { includeDeckLists?: boolean; advanceRound?: boolean } = {}): Promise<{ success: boolean; error?: string }> {
		return runCommandOnce('update', () => updateFromMeleeOnce(options));
	}

	async function syncEventOnce() {
		const outcome = await runMeleeOperation({
			kind: 'event',
			failureTitle: 'Event Sync Failed',
			loadingRef: syncing,
			guardSetsError: true,
			apiCall: eventId => eventRepo.syncMelee(eventId),
			refreshTasks: eventId => [
				{ label: 'event status', run: () => eventStore.loadEvent(eventId) },
				{ label: 'event structure', run: () => refreshMeleeStructureData(eventId) },
			],
			isSuccess: response => response.success,
			successContent: response => ({
				title: 'Event Synced',
				description: `Synced event structure for ${response.event.name}`,
				details: [
					`${response.phases} phase${response.phases !== 1 ? 's' : ''}`,
					`${response.rounds} round${response.rounds !== 1 ? 's' : ''}`,
					...(response.warnings ?? []),
				],
			}),
			failureDescription: () => error.value ?? 'Failed to sync event structure',
		});

		if (outcome.status === 'guard-failed')
			return null;
		return outcome.response;
	}

	function syncEvent() {
		return runCommandOnce('event', syncEventOnce);
	}

	async function syncPlayersOnce() {
		const outcome = await runMeleeOperation({
			kind: 'players',
			failureTitle: 'Player Sync Failed',
			loadingRef: syncingPlayers,
			guardSetsError: true,
			apiCall: eventId => eventRepo.syncPlayers(eventId),
			refreshTasks: eventId => [
				{ label: 'metagame cache', run: () => metagameStore.applyRemoteInvalidated() },
				{ label: 'event status', run: () => eventStore.loadEvent(eventId) },
				{ label: 'players', run: () => playerStore.loadPlayersByEventId(eventId) },
				{ label: 'feature matches', run: () => featureMatchStore.loadFeatureMatchesByEventId(eventId) },
			],
			isSuccess: response => response.success,
			successContent: (response) => {
				const deactivated = response.results.deactivated ?? 0;
				const total = response.results.created + response.results.updated + deactivated;
				return {
					title: 'Players Synced',
					description: `${total} player change${total !== 1 ? 's' : ''} applied`,
					details: [
						`${response.results.created} created`,
						`${response.results.updated} updated`,
						...(deactivated > 0 ? [`${deactivated} deactivated`] : []),
						...(response.warnings ?? []),
					],
				};
			},
			failureDescription: () => error.value ?? 'Failed to sync players',
		});

		if (outcome.status === 'guard-failed')
			return null;
		return outcome.response;
	}

	function syncPlayers() {
		return runCommandOnce('players', syncPlayersOnce);
	}

	async function syncDecklistsOnce() {
		const outcome = await runMeleeOperation({
			kind: 'decklists',
			failureTitle: 'Deck List Sync Failed',
			loadingRef: syncingDecklists,
			guardSetsError: true,
			apiCall: eventId => eventRepo.syncDecklists(eventId),
			refreshTasks: eventId => [
				{ label: 'metagame cache', run: () => metagameStore.applyRemoteInvalidated() },
				{ label: 'deck cache', run: () => clearPlayerDeckCache() },
				{ label: 'event status', run: () => eventStore.loadEvent(eventId) },
				{ label: 'players', run: () => playerStore.loadPlayersByEventId(eventId) },
				{ label: 'deck lists', run: () => playerDeckStore.loadByEventId(eventId) },
				{ label: 'feature matches', run: () => featureMatchStore.loadFeatureMatchesByEventId(eventId) },
			],
			isSuccess: response => response.success,
			successContent: (response) => {
				const details = [
					`${response.results.deckLists} deck list${response.results.deckLists !== 1 ? 's' : ''}`,
					`${response.results.players} player${response.results.players !== 1 ? 's' : ''}`,
					`${response.results.uniqueCards} unique cards`,
				];
				if (response.results.unresolvedCards > 0)
					details.push(`${response.results.unresolvedCards} unresolved deck entr${response.results.unresolvedCards === 1 ? 'y' : 'ies'}`);
				details.push(...(response.warnings ?? []));
				return {
					title: 'Deck Lists Synced',
					description: `${response.results.deckLists} deck list${response.results.deckLists !== 1 ? 's' : ''} synced`,
					details,
				};
			},
			failureDescription: response => response?.warnings.join(' · ') || error.value || 'Failed to sync deck lists',
		});

		if (outcome.status === 'guard-failed')
			return null;
		return outcome.response;
	}

	function syncDecklists() {
		return runCommandOnce('decklists', syncDecklistsOnce);
	}

	/** Shared implementation for an explicitly selected round sync. */
	async function syncRoundInternal(
		apiCall: () => Promise<{ round: { id: number; name: string }; matchCount: number; created: number; updated: number; warnings: string[] }>,
	): Promise<{ success: true; round: { id: number; name: string }; matchCount: number; created: number; updated: number; warnings: string[]; projectionRefreshErrors: string[] } | { success: false; error: string }> {
		const outcome = await runMeleeOperation({
			kind: 'specific-round',
			failureTitle: 'Round Sync Failed',
			loadingRef: syncingRound,
			precondition: () => syncingRound.value
				? { error: 'Round sync already in progress', report: false }
				: null,
			steps: {
				start: () => setSyncStep('standings'),
				loading: () => setSyncStep('loading'),
				finish: () => completeSyncStep(),
				fail: () => setSyncStep(null),
			},
			apiCall: () => apiCall(),
			// The canonical Round command also refreshes/deactivates Players. Its
			// aggregate realtime messages exclude this originating connection.
			refreshTasks: (eventId, response) => [
				{ label: 'metagame cache', run: () => metagameStore.applyRemoteInvalidated() },
				{ label: 'event status', run: () => eventStore.loadEvent(eventId) },
				{ label: 'players', run: () => playerStore.loadPlayersByEventId(eventId) },
				{ label: 'rounds', run: () => roundStore.loadRoundsByEventId(eventId) },
				{ label: 'feature matches', run: () => featureMatchStore.loadFeatureMatchesByEventId(eventId) },
				{ label: 'matches', run: () => refreshLoadedMatches(eventId, [response.round.id]) },
			],
			isSuccess: () => true,
			successContent: response => ({
				title: 'Round Synced',
				description: `${response.round.name} synced successfully`,
				details: [
					`${response.matchCount} matches`,
					`${response.created} created`,
					`${response.updated} updated`,
					...(response.warnings ?? []),
				],
			}),
			failureDescription: () => error.value ?? 'Unknown error',
		});

		if (outcome.status !== 'success')
			return { success: false, error: outcome.error };
		return {
			success: true,
			round: outcome.response.round,
			matchCount: outcome.response.matchCount,
			created: outcome.response.created,
			updated: outcome.response.updated,
			warnings: outcome.response.warnings ?? [],
			projectionRefreshErrors: outcome.projectionRefreshErrors,
		};
	}

	/**
	 * Sync matches for a specific round by its DB round ID.
	 */
	function syncSpecificRound(roundId: number): Promise<{ success: boolean; error?: string }> {
		return runCommandOnce(`specific-round:${roundId}`, () => syncRoundInternal(() => eventRepo.syncSpecificRound(eventStore.eventId!, roundId)));
	}

	/**
	 * Run initial setup: Event + Players + Deck Lists
	 * Call this after saving Melee credentials for the first time.
	 * Does NOT sync any round matches — that's a separate conscious action.
	 */
	async function runInitialSetupOnce(): Promise<{ success: boolean; error?: string }> {
		const outcome = await runMeleeOperation({
			kind: 'setup',
			failureTitle: 'Initial Setup Failed',
			loadingRef: runningSetup,
			precondition: () => runningSetup.value
				? { error: 'Setup already in progress', report: true }
				: null,
			steps: {
				start: () => setSetupStep('syncing'),
				loading: () => setSetupStep('loading'),
				finish: (response) => {
					if (response.success)
						completeSetupStep();
					else
						setSetupStep(null);
				},
				fail: () => setSetupStep(null),
			},
			apiCall: (eventId: number) => eventRepo.runInitialSetup(eventId),
			refreshTasks: eventId => [
				{ label: 'metagame cache', run: () => metagameStore.applyRemoteInvalidated() },
				{ label: 'deck cache', run: () => clearPlayerDeckCache() },
				{ label: 'event status', run: () => eventStore.loadEvent(eventId) },
				{ label: 'phases', run: () => phaseStore.loadPhasesByEventId(eventId) },
				{ label: 'rounds', run: () => roundStore.loadRoundsByEventId(eventId) },
				{ label: 'players', run: () => playerStore.loadPlayersByEventId(eventId) },
				{ label: 'deck lists', run: () => playerDeckStore.loadByEventId(eventId) },
				{ label: 'feature matches', run: () => featureMatchStore.loadFeatureMatchesByEventId(eventId) },
			],
			isSuccess: response => response.success,
			successContent: response => ({
				title: 'Initial Setup Complete',
				description: 'Event structure, players, and deck lists were synced successfully',
				details: response.warnings ?? [],
			}),
			failureDescription: response => response
				? response.warnings.at(-1) ?? response.message ?? 'Failed to run initial setup'
				: error.value ?? 'Unknown error',
			failureDetails: projectionRefreshErrors => projectionRefreshErrors,
		});

		if (outcome.status === 'success')
			return { success: true };
		return { success: false, error: outcome.error };
	}

	function runInitialSetup(): Promise<{ success: boolean; error?: string }> {
		return runCommandOnce('setup', runInitialSetupOnce);
	}

	function $reset() {
		syncing.value = false;
		syncingPlayers.value = false;
		syncingDecklists.value = false;
		syncingRound.value = false;
		updatingFromMelee.value = false;
		runningSetup.value = false;
		setSetupStep(null);
		setSyncStep(null);
		error.value = null;
		lastOperation.value = null;
	}

	return {
		// State
		syncing,
		syncingPlayers,
		syncingDecklists,
		syncingRound,
		updatingFromMelee,
		runningSetup,
		setupStep,
		syncStep,
		error,
		lastOperation,

		// Computed
		hasCredentials,
		availableRounds,
		nextUnsyncedRound,
		nextRoundLabel,
		allRoundsSynced,
		syncedRoundCount,
		totalRoundCount,

		// Actions
		updateFromMelee,
		syncEvent,
		syncPlayers,
		syncDecklists,
		syncSpecificRound,
		runInitialSetup,
		setLastOperation,
		$reset,
	};
});
