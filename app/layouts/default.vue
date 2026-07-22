<script setup lang="ts">
import type { NavigationMenuItem } from '#ui/types';

interface Props {
	flush?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
	flush: false,
});

const colorMode = useColorMode();
const eventStore = useEventStore();
const screenStore = useScreenStore();
const route = useRoute();
const eventId = computed(() => eventStore.eventId);
const meleeEnabled = computed(() => eventStore.event?.meleeEnabled ?? false);
const meleeConfigured = computed(() => eventStore.event?.meleeConfigured ?? false);

watch(eventId, (id) => {
	if (id && !screenStore.isLoaded)
		void screenStore.loadScreensByEventId(id);
}, { immediate: true });

const open = ref(false);

const title = computed(() => {
	return route.meta?.title;
});

const colorModeItem = computed<NavigationMenuItem[]>(() => [{
	label: colorMode.value === 'dark' ? 'Dark mode' : 'Light mode',
	icon: colorMode.value === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun',
	onSelect: () => {
		colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark';
	},
}]);

interface NavGroup {
	label: string;
	items: NavigationMenuItem[];
}

const navGroups = computed<NavGroup[]>(() => {
	if (!eventId.value)
		return [];
	const id = eventId.value;

	return [
		{
			label: 'Event',
			items: [
				{ label: 'Controls', icon: 'i-lucide-sliders-horizontal', to: `/event/${id}` },
				{ label: 'Players', icon: 'i-lucide-users', to: `/event/${id}/players` },
				{ label: 'Matches', icon: 'i-lucide-swords', to: `/event/${id}/matches` },
				...(meleeEnabled.value
					? [{ label: 'Metagame', icon: 'i-lucide-pie-chart', to: `/event/${id}/metagame` }]
					: []),
				...(meleeEnabled.value
					? [{ label: 'Archetype Review', icon: 'i-lucide-tags', to: `/event/${id}/archetype-review` }]
					: []),
				...(meleeEnabled.value && meleeConfigured.value
					? [{ label: 'Sync', icon: 'i-lucide-refresh-cw', to: `/event/${id}/sync` }]
					: []),
			],
		},
		{
			label: 'Production',
			items: [
				{ label: 'Feature Matches', icon: 'i-lucide-trophy', to: `/event/${id}/feature-matches` },
				{ label: 'Cards', icon: 'i-lucide-book-image', to: `/event/${id}/card` },
				{
					label: 'Screens',
					icon: 'i-lucide-monitor',
					to: `/event/${id}/screens`,
					...(screenStore.screens.length > 0 && {
						defaultOpen: true,
						children: screenStore.screens.map(screen => ({
							label: screen.name,
							to: `/event/${id}/screens/${screen.id}`,
						})),
					}),
				},
			],
		},
		{
			label: 'Settings',
			items: [
				{
					label: 'Settings',
					icon: 'i-lucide-settings',
					defaultOpen: true,
					children: [
						{ label: 'Event', to: `/event/${id}/config`, exact: true },
						{ label: 'Event Structure', to: `/event/${id}/rounds` },
						{ label: 'Features', to: `/event/${id}/config/features` },
						{ label: 'Broadcast', to: `/event/${id}/config/broadcast` },
						{ label: 'Integrations', to: `/event/${id}/config/integrations` },
					],
				},
			],
		},
	];
});

// Keep flat links for non-event pages
const homeLinks = computed<NavigationMenuItem[]>(() => [{
	label: 'Events',
	icon: 'i-lucide-calendar',
	to: '/',
}]);
</script>

<template>
	<UDashboardGroup>
		<UDashboardSidebar
			v-model:open="open"
			collapsible
			resizable
			:default-size="15"
			:min-size="15"
			:max-size="15"
			class="bg-elevated/25"
		>
			<template v-if="eventStore.event" #header="{ collapsed }">
				<UButton
					color="neutral"
					variant="ghost"
					icon="i-lucide-calendar"
					:label="collapsed ? undefined : eventStore.event?.name"
					:square="collapsed"
					:block="!collapsed"
					@click="() => { void navigateTo('/') }"
				/>
			</template>
			<template #default="{ collapsed }">
				<template v-if="eventId && navGroups.length > 0">
					<div v-for="(group, idx) in navGroups" :key="group.label" :class="{ 'mt-4': idx > 0 }">
						<div v-if="!collapsed" class="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">
							{{ group.label }}
						</div>
						<USeparator v-else-if="idx > 0" class="mb-2" />
						<UNavigationMenu
							:collapsed="collapsed"
							:items="group.items"
							orientation="vertical"
						/>
					</div>
				</template>
				<UNavigationMenu
					v-else
					:collapsed="collapsed"
					:items="homeLinks"
					orientation="vertical"
				/>
			</template>
			<template #footer="{ collapsed }">
				<div class="flex w-full items-center" :class="collapsed ? 'flex-col gap-1' : 'gap-1'">
					<UNavigationMenu
						:collapsed="collapsed"
						:items="colorModeItem"
						class="flex-1"
						orientation="vertical"
					/>
					<UIServerTimeStatus />
				</div>
			</template>
		</UDashboardSidebar>
		<UDashboardPanel :ui="{ body: 'p-0 sm:p-0' }">
			<template #header>
				<UDashboardNavbar :title="title">
					<template #leading>
						<UDashboardSidebarCollapse />
					</template>
					<template #default>
						<div class="flex items-center gap-3">
							<slot name="navbar-center" />
						</div>
					</template>
					<template #right>
						<slot name="actions" />
					</template>
				</UDashboardNavbar>
				<slot name="toolbar" />
			</template>
			<template #body>
				<div
					id="main-content"
					:class="props.flush ? 'flex flex-col flex-1 min-h-0' : 'p-4 sm:p-6'"
					tabindex="-1"
				>
					<slot />
				</div>
			</template>
		</UDashboardPanel>
	</UDashboardGroup>
</template>
