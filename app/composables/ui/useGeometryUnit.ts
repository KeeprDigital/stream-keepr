import type { GeometryUnit } from '~~/shared/types/graphics';
import { useLocalStorage } from '@vueuse/core';
import { GEOMETRY_UNIT_VALUES } from '~~/shared/types/graphics';

const GEOMETRY_UNIT_STORAGE_KEY = 'editor-geometryUnit';

function isGeometryUnit(value: unknown): value is GeometryUnit {
	return (GEOMETRY_UNIT_VALUES as readonly unknown[]).includes(value);
}

function rememberedUnit(): Ref<string> {
	try {
		// Read on mount, so a server render and the first client render agree on px.
		return useLocalStorage<string>(GEOMETRY_UNIT_STORAGE_KEY, 'px', { initOnMounted: true });
	}
	catch {
		// A browser that refuses storage still lets the author switch units for this view.
		return ref('px');
	}
}

/**
 * The Geometry Unit an author works in, remembered per browser under one key
 * for every geometry control, so the compositor Inspector and Source Item
 * bounds open in whichever unit was chosen last in either.
 *
 * Pixels when nothing usable is stored: a convenience, never configuration.
 */
export function useGeometryUnit() {
	const stored = rememberedUnit();
	return computed<GeometryUnit>({
		get: () => isGeometryUnit(stored.value)
			? stored.value
			: 'px',
		set: (unit) => {
			stored.value = unit;
		},
	});
}
