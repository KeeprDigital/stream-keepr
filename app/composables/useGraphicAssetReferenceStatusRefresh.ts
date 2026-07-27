const STATUS_REFRESH_SIGNAL_KEY = 'graphic-asset-reference-status-refresh-signal';

export function useGraphicAssetReferenceStatusRefresh() {
	const signal = useState<boolean>(STATUS_REFRESH_SIGNAL_KEY, () => false);

	function requestRefresh() {
		signal.value = !signal.value;
	}

	return {
		signal: readonly(signal),
		requestRefresh,
	};
}
