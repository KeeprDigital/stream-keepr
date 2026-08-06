<script lang="ts" setup>
import type { DropdownMenuItem } from '@nuxt/ui';
import type { Screen, ScreenCommand, ScreenMode } from '~/types';
import { getScreenModeDisplayType, getScreenModeIcon, getScreenModeLabel, getScreenModeSelectOptions } from '~/modules/screen-mode';

const props = defineProps<{
	screen: Screen;
	eventId: number;
	connectedCount: number;
	isUpdating: boolean;
}>();

const emit = defineEmits<{
	edit: [];
	delete: [];
	setMode: [mode: ScreenMode];
	sendCommand: [command: ScreenCommand];
}>();

const { copyToClipboard } = useCopyToClipboard();
const { screenOutputAccessUrl, openScreenOutput } = useScreenOutputAccessUrl();

const screenUrl = computed(() => {
	const baseUrl = window.location.origin;
	return `${baseUrl}/event/${props.eventId}/screen/${props.screen.slug}`;
});

const modeLabel = computed(() => getScreenModeLabel(props.screen.currentMode));
const modeIcon = computed(() => getScreenModeIcon(props.screen.currentMode));
const displayType = computed(() => getScreenModeDisplayType(props.screen.currentMode));

function accessUrlOptions() {
	return {
		eventId: props.eventId,
		screenId: props.screen.id,
		screenSlug: props.screen.slug,
	};
}

async function copyUrl() {
	await copyToClipboard(await screenOutputAccessUrl(accessUrlOptions()), {
		successTitle: 'URL Copied',
		successDescription: 'Screen URL copied to clipboard',
		errorDescription: 'Failed to copy screen URL to clipboard.',
	});
}

function openInNewTab() {
	void openScreenOutput(accessUrlOptions());
}

const modeItems: DropdownMenuItem[][] = [
	getScreenModeSelectOptions().map(option => ({
		label: option.label,
		icon: option.icon,
		onSelect: () => emit('setMode', option.value),
	})),
];

const actionItems: DropdownMenuItem[][] = [
	[
		{
			label: 'Configure Screen',
			icon: 'i-lucide-settings',
			onSelect: () => navigateTo(`/event/${props.eventId}/screens/${props.screen.id}`),
		},
		{
			label: 'Copy URL',
			icon: 'i-lucide-copy',
			onSelect: copyUrl,
		},
		{
			label: 'Open in New Tab',
			icon: 'i-lucide-external-link',
			onSelect: openInNewTab,
		},
	],
	[
		{
			label: 'Refresh Clients',
			icon: 'i-lucide-refresh-cw',
			onSelect: () => emit('sendCommand', 'refresh'),
		},
		{
			label: 'Identify',
			icon: 'i-lucide-scan-eye',
			onSelect: () => emit('sendCommand', 'identify'),
		},
		{
			label: 'Debug Overlay',
			icon: 'i-lucide-bug',
			onSelect: () => emit('sendCommand', 'debug'),
		},
	],
	[
		{
			label: 'Edit Screen',
			icon: 'i-lucide-pencil',
			onSelect: () => emit('edit'),
		},
		{
			label: 'Delete Screen',
			icon: 'i-lucide-trash-2',
			color: 'error' as const,
			onSelect: () => emit('delete'),
		},
	],
];
</script>

<template>
	<UCard class="hover:shadow-md transition-shadow">
		<div class="flex items-center justify-between gap-4">
			<NuxtLink
				:to="`/event/${eventId}/screens/${screen.id}`"
				class="flex-1 min-w-0 cursor-pointer hover:opacity-80 transition-opacity"
			>
				<div class="flex items-center gap-2">
					<h4 class="font-medium truncate">
						{{ props.screen.name }}
					</h4>
					<UBadge size="xs" color="neutral" variant="subtle">
						/{{ props.screen.slug }}
					</UBadge>
					<ScreenTypeBadge :display-type="displayType" />
					<UBadge
						v-if="connectedCount > 0"
						size="xs"
						color="success"
						variant="subtle"
					>
						<UIcon name="i-lucide-monitor" class="size-3 mr-1" />
						{{ connectedCount }}
					</UBadge>
				</div>
				<p class="text-sm text-muted mt-1 truncate">
					{{ screenUrl }}
				</p>
			</NuxtLink>

			<div class="flex items-center gap-2">
				<!-- Current Mode Badge -->
				<UDropdownMenu :items="modeItems">
					<UButton
						variant="soft"
						color="neutral"
						size="sm"
						:loading="isUpdating"
						:icon="modeIcon"
						trailing-icon="i-lucide-chevron-down"
					>
						{{ modeLabel }}
					</UButton>
				</UDropdownMenu>

				<!-- Actions -->
				<UDropdownMenu :items="actionItems">
					<UButton
						variant="ghost"
						color="neutral"
						size="sm"
						icon="i-lucide-more-vertical"
						aria-label="Screen actions"
					/>
				</UDropdownMenu>
			</div>
		</div>
	</UCard>
</template>
