/** Which assets a Graphic Asset picker is listing. */
export type GraphicAssetPickerScope = 'event' | 'library';

const PICKER_SCOPE_KEY = 'graphic-asset-picker-scope';

/**
 * The scope a Graphic Asset picker opens on, shared by every picker.
 *
 * Shared because a picker is one component instance per field: an author who
 * widened the scope to find a shared logo for one Media Graphic Item was
 * dropped back into 'This Event' at the next one, and read the reset as the
 * asset having gone (#234).
 *
 * `null` until an author says: only an explicit press is a preference. Anything
 * a picker widened on its own — because 'This Event' held nothing to show — is
 * that opening's business and is not remembered.
 */
export function useGraphicAssetPickerScope() {
	const chosen = useState<GraphicAssetPickerScope | null>(PICKER_SCOPE_KEY, () => null);

	function choose(scope: GraphicAssetPickerScope) {
		chosen.value = scope;
	}

	return { chosen: readonly(chosen), choose };
}
