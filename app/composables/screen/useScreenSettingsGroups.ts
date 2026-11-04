import type { ComputedRef, InjectionKey } from 'vue';

/**
 * The Screen Settings Groups whose Look is mounted on a Screen's settings
 * page, each rendering its Mode Tokens itself, so the residual Screen-wide
 * look leaves them out (ADR-0071). A group counts while any of its mounts is
 * on the page.
 */
export interface ScreenSettingsGroups {
	mounted: ComputedRef<ReadonlySet<string>>;
	/** Count `group` as mounted; the returned function releases it. */
	register: (group: string) => () => void;
}

const SCREEN_SETTINGS_GROUPS: InjectionKey<ScreenSettingsGroups> = Symbol('screen-settings-groups');

/** Provide the page's registry of mounted Screen Settings Groups to everything below it. */
export function provideScreenSettingsGroups(): ScreenSettingsGroups {
	const counts = ref(new Map<string, number>());

	function adjust(group: string, by: number) {
		const next = new Map(counts.value);
		const count = (next.get(group) ?? 0) + by;
		if (count > 0)
			next.set(group, count);
		else
			next.delete(group);
		counts.value = next;
	}

	const groups: ScreenSettingsGroups = {
		mounted: computed(() => new Set(counts.value.keys())),
		register(group) {
			adjust(group, 1);
			let released = false;
			return () => {
				if (released)
					return;
				released = true;
				adjust(group, -1);
			};
		},
	};
	provide(SCREEN_SETTINGS_GROUPS, groups);
	return groups;
}

/** The page's registry of mounted Screen Settings Groups, or null outside a Screen settings page. */
export function useScreenSettingsGroups(): ScreenSettingsGroups | null {
	return inject(SCREEN_SETTINGS_GROUPS, null);
}
