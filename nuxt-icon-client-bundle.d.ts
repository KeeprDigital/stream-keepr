declare module '#build/nuxt-icon-client-bundle' {
	type AddIcon = typeof import('@iconify/vue').addIcon;

	export function init(addIcon: AddIcon): void;
}
