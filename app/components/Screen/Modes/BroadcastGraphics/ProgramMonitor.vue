<script setup lang="ts">
import type { BroadcastGraphicConfig, GraphicChannelConfig } from '~~/shared/types/graphics';
import type { Screen } from '~/types';
import { broadcastGraphicsRenderedInputGraphicAssetReferences } from '~~/shared/modules/broadcast-graphics-live-session';
import { broadcastGraphicsGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';
import { screenOutputPath } from '~~/shared/utils/screenOutput';

/**
 * The persistent Program monitor of a Broadcast Graphics Screen: the operator's own
 * live rendering of the Screen they drive, embedded beside whichever workspace is
 * open (#335).
 *
 * It is one instance, hoisted above the Edit/Live workspace switch, because story 23
 * asks for a *persistent* monitor: an operator who ducks into Edit mid-show keeps
 * the same frame, and a Graphic Input with a live On-air Update Policy can put an
 * Edit-workspace change on program instantly — which is exactly when blindness to
 * what is on air costs the most. For the same reason the card offers no collapse.
 *
 * What it shows is the authoritative Overlay Output composition, not a preview, so
 * it carries no editor guides — and it resolves media exactly as a Screen Output
 * does, through a Screen Output Asset Capability, while being no output itself: it
 * enters no presence and answers no Screen command.
 */
const props = defineProps<{
	eventId: number;
	screen: Screen;
	graphics: readonly BroadcastGraphicConfig[];
	/** The Screen's Graphic Channels, which playout phase timing reads. */
	channels?: readonly GraphicChannelConfig[];
	canvasWidth: number;
	canvasHeight: number;
	/**
	 * Draw at half the viewport share, for the Edit workspace where the monitor sits
	 * over the authoring tree, preview, and inspector. The same monitor either way:
	 * compact changes how much room program takes, never what program is.
	 */
	compact?: boolean;
}>();

const sessionStore = useBroadcastGraphicsLiveSessionStore();

/**
 * The authoritative instant the media warning below is projected at — this
 * surface's own playout clock, advanced from the same authoritative serverNow
 * every Broadcast Graphics surface derives its projections from.
 */
const now = useBroadcastGraphicsPlayoutClock(
	() => props.screen.id,
	() => props.graphics,
	() => props.channels,
);

/**
 * The Program monitor resolves media exactly as a capture browser does — through a
 * Screen Output Asset Capability — though it is no output itself. Without one it
 * would show every graphic except its media, which is the one thing a monitor must
 * not do quietly.
 *
 * So it is never pointed anywhere until the capability has been answered for, and
 * never pointed at all if the answer was no. The capability is fetched
 * asynchronously and starts null, so an iframe bound straight to the URL navigates
 * on the first render, before the fetch lands — and a navigation is not re-run when
 * a later value arrives. That monitor would show a media-less composition while
 * program has media, which is worse than showing no monitor: it is a wrong answer to
 * the question the monitor exists to answer (#231).
 */
const { assetCapability, assetCapabilitySettled } = useScreenOutputAssetCapability(
	() => props.eventId,
	() => props.screen.id,
);

/**
 * The Screen Outputs watching right now that cannot resolve this Screen's assets,
 * and whether this Screen publishes any for them to lose.
 *
 * Both halves are needed before this is worth an operator's attention: an output
 * with no capability watching a Screen that publishes nothing but Shapes and Text
 * is showing program exactly, and warning about it would train an operator to
 * ignore the one warning that matters.
 *
 * Assets rather than media, in the warning's words as well as here: a Graphic
 * Typography naming a library font is an ordinary Graphic Asset Reference resolved
 * through the same capability (#141), so a Screen with no images at all can still
 * lose its typeface, and this predicate counts that correctly.
 *
 * **Both places a Broadcast Graphics Screen publishes from are counted.** The
 * authored stack is one; the media Graphic Input values the Live Session has accepted
 * are the other (#96, #178), and they are not in the configuration any walk over
 * `modeConfigs` can see. A Screen whose only media was chosen live is exactly a Screen
 * whose operator is most likely to have opened an output by hand, and it warned about
 * nothing until #238 — while its outputs lost every one of those choices.
 *
 * Read from the rendering rather than from the accepted set, because the rendering is
 * what an output is drawing at this instant: an acceptance coalescing behind an
 * entrance is not on screen yet, and the values an update is leaving still are.
 */
const outputsWithoutAssetAccess = useScreenOutputAssetAccess(() => props.screen.id);
const publishesMedia = computed(() =>
	broadcastGraphicsGraphicAssetReferences({ graphics: [...props.graphics] }).length > 0
	|| broadcastGraphicsRenderedInputGraphicAssetReferences(
		props.graphics,
		sessionStore.renderedInputValues(props.screen.id, props.graphics, now.value),
	).length > 0,
);

/**
 * The two hand-outs of this Screen's real Overlay Output, offered where the operator
 * is already watching it.
 *
 * Before #237 the Live workspace had neither, so an operator who needed a URL for a
 * capture browser either walked to the Screen settings page or typed
 * `/event/{id}/screen/{slug}` from what they could see — and a hand-typed URL carries
 * no Screen Output Asset Capability, so the output it opens renders every graphic
 * except its images, video and library fonts, with nothing on either side saying so
 * (#231).
 *
 * Both go through `useScreenOutputAccessUrl`, which obtains the capability at the
 * moment of the hand-out and refuses rather than degrading. That is the whole point:
 * a capability read from page state is absent while its load is in flight, absent
 * forever if it failed, and stale the instant anyone rotates it, and every one of
 * those produces a URL indistinguishable from a bare one.
 */
const toast = useToast();
const { copyToClipboard } = useCopyToClipboard();
const { screenOutputAccessUrl, openScreenOutput } = useScreenOutputAccessUrl();

function outputAccessUrlOptions() {
	return {
		eventId: props.eventId,
		screenId: props.screen.id,
		screenSlug: props.screen.slug,
		output: 'overlay' as const,
	};
}

async function copyOutputUrl() {
	// An empty URL is what the composable answers with when it could not obtain a
	// capability, and the clipboard helper reports having nothing rather than putting a
	// media-losing URL on the operator's clipboard.
	await copyToClipboard(await screenOutputAccessUrl(outputAccessUrlOptions()), {
		successTitle: 'Output URL copied',
		successDescription: 'It carries asset access, so the output resolves this Screen\'s media.',
		nothingToCopyTitle: 'Nothing copied',
		nothingToCopyDescription: 'Asset access for this Screen could not be obtained, so the URL would have opened an output without its media. Try again.',
	});
}

/**
 * The two ways an open fails are two different things for the operator to do, so they
 * are said in two different sets of words.
 *
 * Both used to arrive as one `false` and both were reported as an asset access
 * refusal — which asks the operator to try again, and a blocked tab is blocked again
 * identically. What that operator needs is their browser's pop-up setting, and until
 * #258 nothing here could tell them so.
 */
async function openOutput() {
	const result = await openScreenOutput(outputAccessUrlOptions());
	if (result === 'opened')
		return;

	// A refused open opened a tab and closed it again unpointed, so the operator is
	// looking at nothing having happened either way. Said, rather than left to be read
	// as whichever of the two the operator guesses at.
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
 * The operator's own view of program: live in every way an output is, and not one.
 *
 * `embed: 'monitor'` is the whole of that distinction. It is what keeps this frame
 * out of the Screen's presence, which the connected count, the Open Screen Output
 * Engines, and the asset-access warning below are all read from — without it this
 * monitor reported one client live with nothing open anywhere, and named the
 * operator's own browser among the engines it states a Graphic Asset Revision's cost
 * against.
 *
 * Deliberately not `embed: 'preview'`, which would suppress presence too and cost the
 * monitor everything it exists for: a preview composes the stack its embedder pushes
 * it rather than playout, and this monitor's embedder pushes none, so it would sit
 * empty however much was on air.
 */
const programUrl = computed(() => screenOutputPath({
	eventId: props.eventId,
	screenSlug: props.screen.slug,
	output: 'overlay',
	embed: 'monitor',
	assetCapability: assetCapability.value,
}));
const PROGRAM_ZOOM_OPTIONS = [
	{ label: 'Fit', value: 'fit' },
	{ label: '50%', value: '0.5' },
	{ label: '100%', value: '1' },
] as const;
type ProgramZoom = typeof PROGRAM_ZOOM_OPTIONS[number]['value'];
type ProgramBackground = 'transparent' | 'black' | 'white' | 'green';
const PROGRAM_BACKGROUND_OPTIONS: Array<{ label: string; value: ProgramBackground }> = [
	{ label: 'Transparency', value: 'transparent' },
	{ label: 'Black', value: 'black' },
	{ label: 'White', value: 'white' },
	{ label: 'Green', value: 'green' },
];
const programZoom = ref<ProgramZoom>('fit');
const programBackground = ref<ProgramBackground>('transparent');
const programAspectStyle = computed(() => programZoom.value === 'fit'
	? {
			aspectRatio: `${props.canvasWidth} / ${props.canvasHeight}`,
			width: `calc(${props.canvasWidth / props.canvasHeight} * ${props.compact ? 23 : 46}vh)`,
			maxWidth: '100%',
		}
	: {
			width: `${props.canvasWidth * Number(programZoom.value)}px`,
			height: `${props.canvasHeight * Number(programZoom.value)}px`,
			maxWidth: 'none',
		});
const programBackgroundStyle = computed(() => {
	if (programBackground.value === 'black')
		return { backgroundColor: '#000000' };
	if (programBackground.value === 'white')
		return { backgroundColor: '#ffffff' };
	if (programBackground.value === 'green')
		return { backgroundColor: '#00b140' };
	return undefined;
});
</script>

<template>
	<!--
		Never collapsible: a Program monitor that can be hidden is not persistent, and
		absent exactly when the mistake it guards against happens (#335).
	-->
	<ScreenSettingsCard title="Program" :collapsible="false">
		<!--
			Named by what they hand out and by what the hand-out carries, rather
			than by a bare icon: the alternative an operator reaches for is the
			address in their own browser's bar, and nothing distinguishes that one
			from these until a control says what it is putting in the URL.
		-->
		<template #actions>
			<div class="flex flex-wrap items-center gap-2">
				<UFieldGroup size="xs">
					<UButton
						v-for="zoom in PROGRAM_ZOOM_OPTIONS"
						:key="zoom.value"
						:color="programZoom === zoom.value ? 'primary' : 'neutral'"
						:variant="programZoom === zoom.value ? 'subtle' : 'outline'"
						:aria-label="`${zoom.label} program monitor zoom`"
						@click="() => { programZoom = zoom.value }"
					>
						{{ zoom.label }}
					</UButton>
				</UFieldGroup>
				<USelect
					v-model="programBackground"
					:items="PROGRAM_BACKGROUND_OPTIONS"
					value-key="value"
					size="xs"
					class="w-32"
					aria-label="Program monitor background"
				/>
				<UFieldGroup size="xs">
					<UButton
						color="neutral"
						variant="soft"
						icon="i-lucide-external-link"
						title="Open this Screen's Overlay Output in a new tab, with the asset access that resolves its media"
						data-testid="open-screen-output"
						@click="openOutput"
					>
						Open output
					</UButton>
					<UButton
						color="neutral"
						variant="soft"
						icon="i-lucide-copy"
						title="Copy this Screen's Overlay Output URL, with the asset access that resolves its media"
						data-testid="copy-screen-output-url"
						@click="copyOutputUrl"
					>
						Copy output URL
					</UButton>
				</UFieldGroup>
			</div>
		</template>
		<!--
			This monitor is not the only output, and it is the one output guaranteed
			to hold its capability. An output that arrived without one is showing this
			composition with its media missing, which looks like nothing at all from
			here (#231).
		-->
		<UAlert
			v-if="outputsWithoutAssetAccess > 0 && publishesMedia"
			class="mb-2"
			data-testid="outputs-without-asset-access"
			color="warning"
			variant="soft"
			icon="i-lucide-image-off"
			:title="outputsWithoutAssetAccess === 1
				? 'One Screen Output cannot resolve this Screen\'s assets'
				: `${outputsWithoutAssetAccess} Screen Outputs cannot resolve this Screen's assets`"
			description="It is rendering everything except images, video and library fonts. Re-open it with Open output above, which is what puts asset access in the URL."
		/>
		<!--
			Asset access could not be obtained, so there is no monitor to show. Stated
			rather than left blank, and deliberately not replaced by a monitor without
			it: one of those shows a composition this Screen is not putting on air.
		-->
		<UAlert
			v-if="assetCapabilitySettled && !assetCapability"
			data-testid="program-monitor-unavailable"
			color="warning"
			variant="soft"
			icon="i-lucide-monitor-off"
			title="Program monitor unavailable"
			description="Asset access for this Screen could not be obtained, so the monitor would render this composition without its media. Playout below is unaffected; reload to try again."
		/>
		<div v-else class="overflow-auto">
			<div
				class="relative mx-auto overflow-hidden"
				:class="[
					programZoom === 'fit' ? '' : 'shrink-0',
					{ 'transparent-checkerboard-backdrop': programBackground === 'transparent' },
				]"
				:style="[programAspectStyle, programBackgroundStyle]"
			>
				<iframe
					v-if="assetCapability"
					:src="programUrl"
					class="absolute inset-0 size-full border-0"
					title="Broadcast Graphics program monitor"
					data-testid="program-monitor"
				/>
			</div>
		</div>
	</ScreenSettingsCard>
</template>
