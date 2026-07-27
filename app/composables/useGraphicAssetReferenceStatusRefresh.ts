const STATUS_REFRESH_GENERATION_KEY = 'graphic-asset-reference-status-refresh-generation';

export function useGraphicAssetReferenceStatusRefresh() {
	const generation = useState<number>(STATUS_REFRESH_GENERATION_KEY, () => 0);

	function requestRefresh() {
		generation.value += 1;
	}

	return {
		generation: readonly(generation),
		requestRefresh,
	};
}
