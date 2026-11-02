<script setup lang="ts">
import type { Game } from '~~/shared/types/enums';
import type { NavigationMenuItem } from '#ui/types';
import { EVERY_CARD_GAME, MTG_ONLY } from '~~/shared/config/games';
import { isLocalDeveloperUserId } from '~~/shared/utils/localDeveloperAuth';
import { LOGIN_PATH } from '~/modules/auth/pageGate';
import { useAuthSession } from '~/modules/auth/session';
import { useConsumedEventData } from '~/modules/event-data/resync';

interface Props {
	flush?: boolean;
	/**
	 * Editor Focus Mode (#744): the app sidebar is not rendered, so a graphics
	 * editor gets its width. The sidebar's own collapse is left alone — it is the
	 * operator's remembered choice, and Focus Mode must not overwrite it. The
	 * connection statuses its footer carried move into the navbar.
	 */
	editorFocus?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
	flush: false,
	editorFocus: false,
});

const colorMode = useColorMode();
const eventStore = useEventStore();
const screenStore = useScreenStore();
const route = useRoute();
const eventId = computed(() => eventStore.eventId);
const meleeEnabled = computed(() => eventStore.event?.meleeEnabled ?? false);
const meleeConfigured = computed(() => eventStore.event?.meleeConfigured ?? false);
const cardGame = computed(() => eventStore.event?.game);

// The Event header and the Screen navigation, on every page this layout frames.
useConsumedEventData(['event', 'screens']);

watch(eventId, (id) => {
	if (id && !screenStore.isLoaded)
		void screenStore.loadScreensByEventId(id);
}, { immediate: true });

const open = ref(false);

const title = computed(() => {
	return route.meta?.title;
});

const colorModeItem = computed<NavigationMenuItem[]>(() => [
	{
		label: colorMode.value === 'dark'
			? 'Dark mode'
			: 'Light mode',
		icon: colorMode.value === 'dark'
			? 'i-lucide-moon'
			: 'i-lucide-sun',
		onSelect: () => {
			colorMode.preference = colorMode.value === 'dark'
				? 'light'
				: 'dark';
		},
	},
]);

const session = useAuthSession();
const currentUser = session.user;
const isLocalDeveloperUser = computed(() => currentUser.value !== null && isLocalDeveloperUserId(currentUser.value.id));
const accountLabel = computed(() => isLocalDeveloperUser.value ? currentUser.value?.name : currentUser.value?.email);
const toast = useToast();

/**
 * Sign-out lives in the sidebar footer, beside the colour mode, because that
 * is where the things belonging to this browser rather than to the Event sit.
 *
 * In ordinary authentication the operator's address and sign-out action answer
 * which account this laptop holds. The Local Developer User instead shows its
 * conspicuous name and no sign-out action: the bypass would immediately mint
 * the same identity again, so sign-out would claim to do something it cannot.
 */
const accountItems = computed<NavigationMenuItem[]>(() => isLocalDeveloperUser.value
	? []
	: [
			{
				label: 'Sign out',
				icon: 'i-lucide-log-out',
				onSelect: () => {
					void signOut();
				},
			},
		]);

/**
 * Navigating only after the server agreed the session is over. A sign-out that
 * failed leaves the operator where they were with the failure said out loud —
 * dropping them on the login page over a session that is still live would be
 * the app telling them something untrue about their own credentials.
 */
async function signOut() {
	const result = await session.signOut();

	if (!result.ok) {
		toast.add({
			title: 'Sign out failed',
			description: result.message,
			color: 'error',
		});
		return;
	}

	await navigateTo(LOGIN_PATH);
}

interface NavGroup {
	label: string;
	items: NavigationMenuItem[];
}

/**
 * An Event page's nav entry, declaring the Card Games whose Events it is
 * offered to: a page reading results or the Metagame is Magic: The Gathering
 * only (ADR-0057).
 */
interface EventNavItem extends NavigationMenuItem {
	cardGames: readonly Game[];
}

/** The entries offered to the current Event: those declaring its Card Game. */
function offeredToEvent(items: EventNavItem[]): NavigationMenuItem[] {
	return items
		.filter(item => cardGame.value !== undefined && item.cardGames.includes(cardGame.value))
		.map(({ cardGames: _cardGames, ...item }) => item);
}

function graphicsOperationsCockpitItem(): NavigationMenuItem {
	return {
		label: 'Graphics Operations',
		icon: 'i-lucide-gauge',
		to: '/admin/graphics-assets',
	};
}

function graphicsAssetLibraryHealthItem(): NavigationMenuItem {
	return {
		label: 'Graphics Asset Library health',
		icon: 'i-lucide-activity',
		to: '/admin/graphics-assets/health',
	};
}

function userAdministrationItem(): NavigationMenuItem {
	return {
		label: 'User Administration',
		icon: 'i-lucide-users',
		to: '/admin/users',
	};
}

function themesItem(): NavigationMenuItem {
	return {
		label: 'Themes',
		icon: 'i-lucide-palette',
		to: '/themes',
	};
}

function graphicsAssetLibraryItem(): NavigationMenuItem {
	return {
		label: 'Graphics Asset Library',
		icon: 'i-lucide-images',
		to: '/graphics-assets',
	};
}

const navGroups = computed<NavGroup[]>(() => {
	if (!eventId.value)
		return [];
	const id = eventId.value;

	return [
		{
			label: 'Event',
			items: offeredToEvent([
				{
					label: 'Controls',
					icon: 'i-lucide-sliders-horizontal',
					to: `/event/${id}`,
					cardGames: EVERY_CARD_GAME,
				},
				{
					label: 'Players',
					icon: 'i-lucide-users',
					to: `/event/${id}/players`,
					cardGames: EVERY_CARD_GAME,
				},
				{
					label: 'Matches',
					icon: 'i-lucide-swords',
					to: `/event/${id}/matches`,
					cardGames: EVERY_CARD_GAME,
				},
				...(meleeEnabled.value
					? [
							{
								label: 'Metagame',
								icon: 'i-lucide-pie-chart',
								to: `/event/${id}/metagame`,
								cardGames: MTG_ONLY,
							},
						]
					: []),
				...(meleeEnabled.value
					? [
							{
								label: 'Archetype Review',
								icon: 'i-lucide-tags',
								to: `/event/${id}/archetype-review`,
								cardGames: MTG_ONLY,
							},
						]
					: []),
				...(meleeEnabled.value && meleeConfigured.value
					? [
							{
								label: 'Sync',
								icon: 'i-lucide-refresh-cw',
								to: `/event/${id}/sync`,
								cardGames: MTG_ONLY,
							},
						]
					: []),
			]),
		},
		{
			label: 'Production',
			items: offeredToEvent([
				{
					label: 'Feature Matches',
					icon: 'i-lucide-trophy',
					to: `/event/${id}/feature-matches`,
					cardGames: EVERY_CARD_GAME,
				},
				{
					label: 'Cards',
					icon: 'i-lucide-book-image',
					to: `/event/${id}/card`,
					cardGames: MTG_ONLY,
				},
				{
					label: 'Screens',
					icon: 'i-lucide-monitor',
					to: `/event/${id}/screens`,
					cardGames: EVERY_CARD_GAME,
					...(screenStore.screens.length > 0 && {
						defaultOpen: true,
						children: screenStore.screens.map(screen => ({
							label: screen.name,
							to: `/event/${id}/screens/${screen.id}`,
						})),
					}),
				},
			]),
		},
		{
			label: 'Settings',
			items: offeredToEvent([
				{
					label: 'Settings',
					icon: 'i-lucide-settings',
					defaultOpen: true,
					cardGames: EVERY_CARD_GAME,
					children: [
						{ label: 'Event', to: `/event/${id}/config`, exact: true },
						{ label: 'Event Structure', to: `/event/${id}/rounds` },
						{ label: 'Feature Matches', to: `/event/${id}/config/features` },
						{ label: 'Broadcast', to: `/event/${id}/config/broadcast` },
						{ label: 'Integrations', to: `/event/${id}/config/integrations` },
					],
				},
			]),
		},
		{
			label: 'Administration',
			items: [
				themesItem(),
				graphicsAssetLibraryItem(),
				graphicsOperationsCockpitItem(),
				graphicsAssetLibraryHealthItem(),
				userAdministrationItem(),
			],
		},
	];
});

// Keep flat links for non-event pages
const homeLinks = computed<NavigationMenuItem[]>(() => [
	{
		label: 'Events',
		icon: 'i-lucide-calendar',
		to: '/',
	},
	themesItem(),
	graphicsAssetLibraryItem(),
	graphicsOperationsCockpitItem(),
	graphicsAssetLibraryHealthItem(),
	userAdministrationItem(),
]);
</script>

<template>
	<UDashboardGroup>
		<!--
			A fixed id, so the sidebar's remembered collapse survives Editor Focus
			Mode unmounting it: Nuxt UI otherwise keys that memory by a generated id
			that changes on every remount.
		-->
		<UDashboardSidebar
			v-if="!props.editorFocus"
			id="app"
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
				<div class="flex w-full flex-col gap-1">
					<div
						v-if="!collapsed && currentUser"
						class="px-3 pb-1 text-xs text-muted truncate"
						:title="currentUser.email"
					>
						{{ accountLabel }}
					</div>
					<UNavigationMenu
						:collapsed="collapsed"
						:items="accountItems"
						orientation="vertical"
					/>
					<div class="flex w-full items-center" :class="collapsed ? 'flex-col gap-1' : 'gap-1'">
						<UNavigationMenu
							:collapsed="collapsed"
							:items="colorModeItem"
							class="flex-1"
							orientation="vertical"
						/>
						<UIRealtimeStatus />
						<UIServerTimeStatus />
					</div>
				</div>
			</template>
		</UDashboardSidebar>
		<UDashboardPanel :ui="{ body: 'p-0 sm:p-0' }">
			<template #header>
				<UDashboardNavbar :title="title" :toggle="!props.editorFocus">
					<template v-if="!props.editorFocus" #leading>
						<UDashboardSidebarCollapse />
					</template>
					<template #default>
						<div class="flex items-center gap-3">
							<slot name="navbar-center" />
						</div>
					</template>
					<template #right>
						<template v-if="props.editorFocus">
							<UIRealtimeStatus />
							<UIServerTimeStatus />
						</template>
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
