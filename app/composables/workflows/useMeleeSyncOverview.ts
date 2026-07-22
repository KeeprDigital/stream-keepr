type MeleeSyncState = 'disabled' | 'not-configured' | 'setup-required' | 'in-progress' | 'ready' | 'error' | 'complete';
type MeleeSyncActionType = 'configure' | 'setup' | 'update' | 'open';

interface MeleeSyncAction {
	type: MeleeSyncActionType;
	label: string;
	to?: string;
	loading?: boolean;
	disabled?: boolean;
}

export function useMeleeSyncOverview() {
	const eventStore = useEventStore();
	const meleeStore = useMeleeStore();
	const event = computed(() => eventStore.event);
	const eventId = computed(() => event.value?.id ?? null);
	const isEnabled = computed(() => !!event.value?.meleeEnabled);
	const isConfigured = computed(() => !!(event.value?.meleeEnabled && event.value?.meleeConfigured));
	const setupCompletedAt = computed(() => event.value?.initialSetupCompletedAt ?? null);
	const isSetupComplete = computed(() => !!setupCompletedAt.value);
	const hasLastError = computed(() => !!event.value?.lastSyncError);
	const isAnySyncRunning = computed(() =>
		meleeStore.syncing || meleeStore.syncingPlayers || meleeStore.syncingDecklists || meleeStore.syncingRound || meleeStore.updatingFromMelee || meleeStore.runningSetup,
	);

	const state = computed<MeleeSyncState>(() => {
		if (!isEnabled.value) {
			return 'disabled';
		}

		if (!isConfigured.value) {
			return 'not-configured';
		}

		if (!isSetupComplete.value) {
			return meleeStore.runningSetup ? 'in-progress' : 'setup-required';
		}

		if (isAnySyncRunning.value) {
			return 'in-progress';
		}

		if (hasLastError.value) {
			return 'error';
		}

		if (meleeStore.nextUnsyncedRound) {
			return 'ready';
		}

		return 'complete';
	});

	const primaryAction = computed<MeleeSyncAction | null>(() => {
		if (!eventId.value || state.value === 'disabled') {
			return null;
		}

		if (state.value === 'not-configured') {
			return {
				type: 'configure',
				label: 'Configure Integration',
				to: `/event/${eventId.value}/config/integrations`,
			};
		}

		if (state.value === 'setup-required' || (state.value === 'in-progress' && !isSetupComplete.value)) {
			return {
				type: 'setup',
				label: 'Run Initial Setup',
				loading: meleeStore.runningSetup,
				disabled: isAnySyncRunning.value && !meleeStore.runningSetup,
			};
		}

		if (state.value === 'ready' || state.value === 'error' || state.value === 'complete' || (state.value === 'in-progress' && isSetupComplete.value)) {
			return {
				type: 'update',
				label: 'Update from Melee',
				loading: meleeStore.updatingFromMelee,
				disabled: isAnySyncRunning.value && !meleeStore.updatingFromMelee,
			};
		}

		return null;
	});

	const secondaryAction = computed<MeleeSyncAction | null>(() => {
		if (!eventId.value || !isConfigured.value || state.value === 'disabled') {
			return null;
		}

		return {
			type: 'open',
			label: 'Open Melee Sync',
			to: `/event/${eventId.value}/sync`,
		};
	});

	const statusTitle = computed(() => {
		switch (state.value) {
			case 'not-configured': return 'Melee Sync Not Configured';
			case 'setup-required': return 'Initial Setup Required';
			case 'in-progress': return isSetupComplete.value ? 'Melee Sync In Progress' : 'Initial Setup In Progress';
			case 'ready': return 'Melee Update Ready';
			case 'error': return 'Melee Sync Needs Attention';
			case 'complete': return 'Melee Sync Ready';
			default: return 'Melee Sync';
		}
	});

	const statusDescription = computed(() => {
		switch (state.value) {
			case 'not-configured':
				return 'Add your Melee.gg credentials before running sync operations.';
			case 'setup-required':
				return 'Run initial setup to import event structure, players, and deck lists from Melee.gg.';
			case 'in-progress':
				return meleeStore.lastOperation?.status === 'error'
					? meleeStore.lastOperation.description
					: 'Sync is currently running. Progress will update in place.';
			case 'ready':
				return meleeStore.nextRoundLabel
					? 'Update from Melee will refresh standings/results, then import the next round.'
					: 'Update from Melee will refresh the current tournament state.';
			case 'error':
				return event.value?.lastSyncError ?? 'The last sync operation failed.';
			case 'complete':
				return 'All known rounds have been imported. Update from Melee will refresh current standings and recent round results.';
			default:
				return '';
		}
	});

	return {
		event,
		eventId,
		state,
		isEnabled,
		isConfigured,
		isSetupComplete,
		isAnySyncRunning,
		hasLastError,
		primaryAction,
		secondaryAction,
		statusTitle,
		statusDescription,
		setupCompletedAt,
	};
}
