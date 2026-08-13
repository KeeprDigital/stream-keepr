import type { VueWrapper } from '@vue/test-utils';
import type { Component, ComputedRef } from 'vue';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { useUnsavedChanges } from '~/composables/ui/useUnsavedChanges';

export interface PageGuardMountOptions {
	/** Props for the component under test, not for the page around it. */
	props?: Record<string, unknown>;
	attachTo?: Element | string;
	global?: Record<string, unknown>;
}

export interface PageGuardMount<W> {
	/** The component under test, found inside the page that installed the guard. */
	wrapper: W;
	/** The page's own dirty state — what the navigation guard consults before leaving. */
	pageIsDirty: () => boolean;
	/** The page itself, for the rare assertion that is about the page rather than the component. */
	page: VueWrapper<any>;
}

/**
 * Mounts a component inside a page that has installed the unsaved-changes guard,
 * the way `pages/event/[eventId]/config.vue` and `pages/event/[eventId]/index.vue`
 * do for their children.
 *
 * `useRegisterDirtyState` registers through `inject`, and the injection key is a
 * module-private `Symbol` — so no test can supply it directly. Mounted bare, a
 * component injects nothing, its registration is a silent no-op, and deleting the
 * registration outright leaves the suite green. This harness is the only way the
 * registration is observable: it provides the key by running the real page-level
 * composable, and hands back the page's `isDirty` so a test can assert that the
 * component's own dirty state reaches it.
 *
 * Callers must mock two auto-imports themselves, because `mockNuxtImport` is
 * hoisted per test file and cannot be applied from here — the page composable
 * reaches for both while installing itself:
 *
 * ```ts
 * mockNuxtImport('useOverlay', () => () => ({
 *   create: () => ({ open: () => ({ result: Promise.resolve(true) }) }),
 * }));
 * mockNuxtImport('onBeforeRouteLeave', () => () => {});
 * ```
 *
 * @example
 * const { wrapper, pageIsDirty } = mountUnderPageGuard(ConfigEventSettings, {
 *   props: { event },
 *   global: { stubs },
 * });
 * expect(pageIsDirty()).toBe(false);
 * await nameField(wrapper).setValue('Renamed');
 * expect(pageIsDirty()).toBe(true);
 */
export function mountUnderPageGuard<W extends VueWrapper<any> = VueWrapper<any>>(
	component: Component,
	options: PageGuardMountOptions = {},
): PageGuardMount<W> {
	const { props, ...pageOptions } = options;
	let guard: ComputedRef<boolean> | null = null;

	const Page = defineComponent({
		name: 'PageWithGuard',
		setup() {
			guard = useUnsavedChanges().isDirty;
			return () => h(component, props);
		},
	});

	const page = mount(Page, pageOptions);

	return {
		wrapper: page.findComponent(component) as W,
		pageIsDirty: () => guard!.value,
		page,
	};
}
