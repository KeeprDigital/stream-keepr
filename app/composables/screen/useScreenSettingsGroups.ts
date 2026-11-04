import type { ComputedRef, EffectScope, InjectionKey } from 'vue';

/**
 * The Screen Settings Groups whose Look is mounted on a Screen's settings
 * page, each rendering its Mode Tokens itself, so the residual Screen-wide
 * look leaves them out (ADR-0071). A group counts while any holder of it is
 * on the page.
 */
export interface ScreenSettingsGroups {
	mounted: ComputedRef<ReadonlySet<string>>;
	/** Count `group` as mounted until `owner` is disposed; holding it again under the same owner changes nothing. */
	hold: (group: string, owner: EffectScope) => void;
}

const SCREEN_SETTINGS_GROUPS: InjectionKey<ScreenSettingsGroups> = Symbol('screen-settings-groups');
const SCREEN_SETTINGS_CARD: InjectionKey<EffectScope> = Symbol('screen-settings-card');

/** Provide the page's registry of mounted Screen Settings Groups to everything below it. */
export function provideScreenSettingsGroups(): ScreenSettingsGroups {
	const counts = ref(new Map<string, number>());
	const held = new WeakMap<EffectScope, Set<string>>();

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
		hold(group, owner) {
			const ownerGroups = held.get(owner) ?? new Set<string>();
			held.set(owner, ownerGroups);
			if (ownerGroups.has(group))
				return;
			ownerGroups.add(group);
			adjust(group, 1);
			owner.run(() => onScopeDispose(() => {
				ownerGroups.delete(group);
				adjust(group, -1);
			}));
		},
	};
	provide(SCREEN_SETTINGS_GROUPS, groups);
	return groups;
}

/** The page's registry of mounted Screen Settings Groups, or null outside a Screen settings page. */
export function useScreenSettingsGroups(): ScreenSettingsGroups | null {
	return inject(SCREEN_SETTINGS_GROUPS, null);
}

/**
 * Make the calling `ScreenSettingsCard` own the groups held inside it, so a
 * group whose card is collapsed, which unmounts the card's body, still counts.
 */
export function provideScreenSettingsCardScope() {
	const scope = getCurrentScope();
	if (scope)
		provide(SCREEN_SETTINGS_CARD, scope);
}

/**
 * Count `group` as mounted on the page while the nearest `ScreenSettingsCard`
 * is, collapsed or not, or, outside any card, while the caller is. Call in setup.
 */
export function useScreenSettingsGroup(group: string) {
	const groups = useScreenSettingsGroups();
	const owner = inject(SCREEN_SETTINGS_CARD, null) ?? getCurrentScope();
	if (groups && owner)
		groups.hold(group, owner);
}
