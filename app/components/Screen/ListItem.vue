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

const toast = useToast();
const { copyToClipboard } = useCopyToClipboard();
const { screenOutputAccessUrl, openScreenOutput } = useScreenOutputAccessUrl();

/**
 * This Screen's address, shown so an operator can read where its outputs live.
 *
 * Deliberately not the URL the controls beside it hand out: that one carries this
 * Screen's Screen Output Asset Capability, which is a secret and does not belong on
 * a page anyone can be standing behind. Copy and open produce it; reading this one
 * off the screen and typing it produces an output with no media (#231).
 */
const screenUrl = computed(() => {
	const baseUrl = window.location.origin;
	return `${baseUrl}/event/${props.eventId}/screen/${props.screen.slug}`;
});

const modeLabel = computed(() => getScreenModeLabel(props.screen.currentMode));
const modeIcon = computed(() => getScreenModeIcon(props.screen.currentMode));
const displayType = computed(() => getScreenModeDisplayType(props.screen.currentMode));

// Outputs self-reporting degraded card data through presence (#465), whatever
// mode they render. The settings page says it as a sentence; this row says it as
// a badge, so one glance down the index covers every Screen.
const degradedCardDataCount = useScreenOutputCardDataHealth(() => props.screen.id);
const degradedCardDataTooltip = computed(() =>
	`Card data incomplete on ${degradedCardDataCount.value} ${degradedCardDataCount.value === 1 ? 'output' : 'outputs'} — re-fetching until Scryfall answers`,
);

function accessUrlOptions() {
	return {
		eventId: props.eventId,
		screenId: props.screen.id,
		screenSlug: props.screen.slug,
	};
}

async function copyUrl() {
	await copyToClipboard(await screenOutputAccessUrl(accessUrlOptions()), {
		// Named for the output, not for the Screen. "Screen URL copied to clipboard" was
		// describing the address printed a few pixels above — the one URL on this card
		// that carries no asset access — while copying a different one (#231, #266).
		successTitle: 'Output URL copied',
		successDescription: 'It carries asset access, so the output resolves this Screen\'s media.',
		// The empty string means asset access was refused, not that the clipboard
		// declined the write — and "failed to copy" sends the operator to the address in
		// their browser's bar, which is the media-losing URL the refusal withholds
		// (#231, #257).
		nothingToCopyTitle: 'Nothing copied',
		nothingToCopyDescription: 'Asset access for this Screen could not be obtained, so the URL would have opened an output without its media. Try again.',
	});
}

/**
 * Hands out this Screen's Overlay Output in a new tab, and says which of the two ways
 * it could not.
 *
 * `openScreenOutput` opens the tab on the click and closes it again unpointed when
 * asset access could not be obtained, so an operator whose open was refused is looking
 * at nothing having happened. This card discarded that answer until #269 — the same
 * silence the Live workspace lost in #237 and the settings page in #250, still here on
 * the third surface.
 *
 * A blocked pop-up and a refused capability are opposite instructions — change a
 * browser setting, or try again — so since #258 they arrive as different answers and
 * are said in different words, in the wording both other surfaces already use.
 */
async function openOutput() {
	const result = await openScreenOutput(accessUrlOptions());
	if (result === 'opened')
		return;

	toast.add(result === 'window-blocked'
		? {
				title: 'Output not opened',
				description: 'This browser blocked the new tab. Allow pop-ups for this site, then open the output again.',
				color: 'error',
			}
		: {
				title: 'Output not opened',
				description: 'Asset access for this Screen could not be obtained, so the output would have rendered without its media. Try again.',
				color: 'error',
			});
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
		// Named for what they hand out, and each carrying the sentence saying what that
		// hand-out includes — the #234/#237 voice the other two surfaces adopted in #266.
		// "Copy URL" and "Open in New Tab" named neither the output nor its asset access,
		// and sat beside the Screen's bare address, which is the URL they do NOT produce.
		// The sentence rides on the item rather than on the menu's trigger because that
		// trigger opens every Screen action, not only the two hand-outs.
		{
			label: 'Copy output URL',
			icon: 'i-lucide-copy',
			description: 'Copy this Screen\'s Overlay Output URL, with the asset access that resolves its media',
			onSelect: copyUrl,
		},
		{
			label: 'Open output',
			icon: 'i-lucide-external-link',
			description: 'Open this Screen\'s Overlay Output in a new tab, with the asset access that resolves its media',
			onSelect: openOutput,
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
					<UTooltip v-if="degradedCardDataCount > 0" :text="degradedCardDataTooltip">
						<UBadge
							size="xs"
							color="warning"
							variant="subtle"
							data-testid="card-data-degraded-badge"
							:aria-label="degradedCardDataTooltip"
						>
							<UIcon name="i-lucide-triangle-alert" class="size-3 mr-1" />
							{{ degradedCardDataCount }}
						</UBadge>
					</UTooltip>
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
