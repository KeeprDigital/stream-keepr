<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { SCREEN_OUTPUT_OPTIONS } from '~~/shared/screenModeDefinitions';

/**
 * The one place a Screen Output's URL is handed out: Open and Copy, side by side,
 * in the Screen header and in both graphics editors (#1104).
 *
 * Both go through `useScreenOutputAccessUrl`, which obtains the Screen Output Asset
 * Capability at the moment of the hand-out and refuses rather than degrading: a
 * hand-typed or page-state URL renders every graphic except its media, with nothing
 * on either side saying so (#231). This component owns the words for each outcome,
 * so an operator meets one vocabulary for the same refusal wherever they hand out.
 *
 * With no outputs of its own each control hands out the Screen's output directly;
 * a Screen Mode that has its own Screen Outputs offers them in a menu behind each.
 */
const props = defineProps<{
	eventId: number;
	screen: Pick<Screen, 'id' | 'slug'>;
	/** The Screen Mode's own Screen Outputs, offered after the Screen's output. */
	outputs?: readonly ScreenOutput[];
	size?: 'xs' | 'sm';
	/** Hands nothing out; `disabledReason` says why on each control. */
	disabled?: boolean;
	disabledReason?: string;
}>();

const toast = useToast();
const { copyToClipboard } = useCopyToClipboard();
const { screenOutputAccessUrl, openScreenOutput } = useScreenOutputAccessUrl();

function accessUrlOptions(output?: ScreenOutput) {
	return {
		eventId: props.eventId,
		screenId: props.screen.id,
		screenSlug: props.screen.slug,
		output,
	};
}

function outputLabel(output: ScreenOutput) {
	return SCREEN_OUTPUT_OPTIONS.find(option => option.value === output)!.label;
}

/**
 * The two ways an open fails are two things for the operator to do — retry, or allow
 * pop-ups — so they are two sentences. A refused open closed its tab unpointed, so
 * the operator is looking at nothing having happened either way (#250, #258).
 */
async function openOutput(output?: ScreenOutput) {
	if (props.disabled)
		return;
	const result = await openScreenOutput(accessUrlOptions(output));
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

/**
 * An empty URL is the composable refusing, and the reason is this component's to
 * name: "copy failed" sends an operator to the address in their browser's bar, the
 * media-losing URL this refusal exists to withhold (#257).
 */
async function copyOutputUrl(output?: ScreenOutput) {
	if (props.disabled)
		return;
	await copyToClipboard(await screenOutputAccessUrl(accessUrlOptions(output)), {
		successTitle: output ? `${outputLabel(output)} output URL copied` : 'Output URL copied',
		successDescription: 'It carries asset access, so the output resolves this Screen\'s media.',
		nothingToCopyTitle: 'Nothing copied',
		nothingToCopyDescription: 'Asset access for this Screen could not be obtained, so the URL would have opened an output without its media. Try again.',
	});
}

const hasOwnOutputs = computed(() => (props.outputs?.length ?? 0) > 0);

function menu(
	first: string,
	each: (label: string) => string,
	icon: string,
	handOut: (output?: ScreenOutput) => Promise<void>,
): DropdownMenuItem[][] {
	return [
		[{ label: first, icon, onSelect: () => void handOut() }],
		(props.outputs ?? []).map(output => ({
			label: each(outputLabel(output).toLowerCase()),
			icon: SCREEN_OUTPUT_OPTIONS.find(option => option.value === output)!.icon,
			onSelect: () => void handOut(output),
		})),
	];
}

const openItems = computed(() => menu('Open output', label => `Open ${label} output`, 'i-lucide-external-link', openOutput));
const copyItems = computed(() => menu('Copy output URL', label => `Copy ${label} output URL`, 'i-lucide-copy', copyOutputUrl));

const OPEN_TITLE = 'Open a Screen Output in a new tab, with the asset access that resolves its media';
const COPY_TITLE = 'Copy a Screen Output URL, with the asset access that resolves its media';
</script>

<template>
	<!--
		Named for what they hand out and what the hand-out carries: the alternative an
		operator reaches for is the address in their own browser's bar, which carries no
		asset access (#231, #266).
	-->
	<UFieldGroup :size="size ?? 'sm'" data-testid="output-hand-out">
		<UDropdownMenu v-if="hasOwnOutputs" :items="openItems" :disabled="disabled">
			<UButton
				variant="soft"
				color="neutral"
				icon="i-lucide-external-link"
				trailing-icon="i-lucide-chevron-down"
				label="Open"
				:disabled="disabled"
				:title="disabled ? disabledReason : OPEN_TITLE"
				data-hand-out="open"
			/>
		</UDropdownMenu>
		<UButton
			v-else
			variant="soft"
			color="neutral"
			icon="i-lucide-external-link"
			label="Open"
			aria-label="Open output"
			:disabled="disabled"
			:title="disabled ? disabledReason : OPEN_TITLE"
			data-hand-out="open"
			@click="openOutput()"
		/>
		<UDropdownMenu v-if="hasOwnOutputs" :items="copyItems" :disabled="disabled">
			<UButton
				variant="soft"
				color="neutral"
				icon="i-lucide-copy"
				trailing-icon="i-lucide-chevron-down"
				label="Copy URL"
				:disabled="disabled"
				:title="disabled ? disabledReason : COPY_TITLE"
				data-hand-out="copy"
			/>
		</UDropdownMenu>
		<UButton
			v-else
			variant="soft"
			color="neutral"
			icon="i-lucide-copy"
			label="Copy URL"
			aria-label="Copy output URL"
			:disabled="disabled"
			:title="disabled ? disabledReason : COPY_TITLE"
			data-hand-out="copy"
			@click="copyOutputUrl()"
		/>
	</UFieldGroup>
</template>
