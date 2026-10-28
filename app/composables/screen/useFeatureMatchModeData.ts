export function useFeatureMatchModeData() {
	const config = useScreenModeConfig('feature-match');

	/**
	 * The Slot and its Session come through the Screen (#604), and the Session
	 * follows through the Live State Follower (#592); this mode keeps nothing
	 * else of the read.
	 */
	const { slot: match, state: matchState, loading, error, answered } = useScreenFeatureMatchSlot<null>({
		slotId: () => config.value.featureMatchId,
		keep: () => null,
		initialData: null,
		errorMessage: 'Failed to load feature match data',
	});

	return {
		config,
		match,
		matchState,
		loading,
		error,
		/** Rendering Readiness: its Slot read has answered or failed. */
		ready: answered,
	};
}
