<script setup lang="ts">
import type { BroadcastGraphicsBackgroundConfig } from '~~/shared/animationEffects';
import type { BroadcastGraphicConfig, GraphicChannelConfig } from '~~/shared/types/graphics';
import type { GraphicsAuthoringLeaseStatus } from '~/composables/screen/useGraphicsAuthoringLease';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { Screen } from '~/types';
import { useEventListener } from '@vueuse/core';
import { BROADCAST_GRAPHICS_HOST_CONTRACT, replaceBroadcastGraphic, replaceGraphicItemById } from '~~/shared/modules/graphics';
import { randomUuid } from '~~/shared/utils/uuid';
import GraphicsCompositorInspector from '~/components/Graphics/Compositor/Inspector.vue';
import GraphicsCompositorPreview from '~/components/Graphics/Compositor/Preview.vue';
import GraphicsCompositorStackTree from '~/components/Graphics/Compositor/StackTree.vue';
import { hasTextSelection, useGraphicsClipboard } from '~/composables/useGraphicsClipboard';
import {
	copyGraphicLayers,
	copyGraphicStyle,
	pasteBroadcastGraphicLayers,
	pasteGraphicStyle,
} from '~/modules/graphics/clipboard';
import { graphicsSelectionGraphicId, resolveGraphicsSelection } from '~/modules/graphics/selection';
import { isTypingTarget } from '~/utils/typingTarget';

/**
 * The Edit workspace of a Broadcast Graphics Screen: the shared compositor's
 * authoring tree, preview, and inspector over the Screen's authored stack.
 *
 * The whole workspace is the artifact one Graphics Authoring Lease covers, so
 * exactly one session authors it and every other session observes it. An observer
 * gets the same workspace read-only — the same stack, the same preview, the same
 * properties — because watching a colleague compose is the point, and it takes the
 * lease over when it needs to author instead.
 */
const props = defineProps<{
	eventId: number;
	screen: Screen;
	graphics: readonly BroadcastGraphicConfig[];
	/** The Screen's Graphic Channels: its optional playout lanes. */
	channels: readonly GraphicChannelConfig[];
	/** The Screen's Broadcast Graphics Background, or none authored. */
	background?: BroadcastGraphicsBackgroundConfig;
	selectedTarget: GraphicsSelectionTarget;
	selectedGraphicId: string | null;
	canvasWidth: number;
	canvasHeight: number;
	/** Whether this session currently holds the workspace's Graphics Authoring Lease. */
	writable?: boolean;
	leaseStatus?: GraphicsAuthoringLeaseStatus;
	canTakeOver?: boolean;
	/** Who holds it, where the server could resolve their session to a person. */
	holderName?: string | null;
	/**
	 * Whether the realtime connection feeding the Broadcast Graphics Live Session
	 * is currently down, from the sync the settings surface holds. While it is,
	 * this client cannot know what is on air, and the on-air marks below say so
	 * instead of claiming anything.
	 */
	playoutDisconnected?: boolean;
	/**
	 * The authored save's answer, from the mode-config write this workspace's
	 * edits funnel into (#381). `committed` is an affirmative fact rather than
	 * the absence of `saving`: a save can run for seconds against deployed
	 * remote D1 (#374), and an author who looked away needs the difference
	 * between "it landed" and "the failure toast was missed" said out loud.
	 */
	saveState?: 'idle' | 'saving' | 'committed' | 'failed';
	/**
	 * The sentence the authority wrote about a failed save — a CAS refusal names
	 * the slot to repair — shown verbatim in place of generic wording.
	 */
	saveError?: string | null;
	/**
	 * Lands every unsaved edit of this workspace and answers whether none is left,
	 * for the Template library: a placement rewrites the stored stack and a save
	 * reads it, so neither may run ahead of an edit still on its way.
	 */
	flushEdits?: () => Promise<boolean>;
}>();

const emit = defineEmits<{
	'update:graphics': [graphics: BroadcastGraphicConfig[]];
	/**
	 * Declaring, renaming, repolicying, or deleting a Graphic Channel, together with
	 * any membership the change releases or assigns — one write, because deleting a
	 * lane and releasing its members must never be two.
	 */
	'update:channels': [next: { channels?: GraphicChannelConfig[]; graphics?: BroadcastGraphicConfig[] }];
	/** The Screen's one background: its effect, its params, and whether it shows. */
	'update:background': [background: BroadcastGraphicsBackgroundConfig];
	'update:selectedTarget': [target: GraphicsSelectionTarget];
	'takeOver': [];
	/** Re-send the failed save's still-held updates. */
	'retrySave': [];
}>();

/**
 * The Broadcast Graphic an author can save as a Broadcast Graphic Template.
 *
 * Saving copies one finished design, not the Screen's whole stack, so the library
 * offers exactly the graphic the author is looking at.
 */
const selectedGraphic = computed(() =>
	props.graphics.find(graphic => graphic.id === props.selectedGraphicId) ?? null,
);

/**
 * The game of the Event this Screen belongs to.
 *
 * The inspector needs it to author Graphic Input Bindings: the field catalog
 * separates stable common fields from ones specific to the current Event's game, and
 * an author must never be offered a field this Event cannot resolve.
 */
const eventStore = useEventStore();
const game = computed(() => eventStore.event?.game);

/**
 * The Theme the workspace previews under (#829): this Screen's Event's, unless
 * the author picks another to see the design under a different Theme.
 */
const previewTheme = useGraphicsPreviewTheme(() => eventStore.event?.themeId);

/**
 * The Broadcast Graphics currently composing into a program output (#373).
 *
 * Read from the same Broadcast Graphics Live Session store the hoisted Program
 * monitor projects from — one authority, so the mark in the tree can never
 * disagree with the monitor beside it — at this surface's own playout clock
 * instant. The set covers entering, on-air, updating, and exiting, because a
 * graphic composes into the frame in all four, and that is exactly when an
 * Edit-workspace change under a live On-air Update Policy can reach program.
 * `waiting` is deliberately outside it: a waiting graphic is on no output yet.
 */
const sessionStore = useBroadcastGraphicsLiveSessionStore();
const playoutNow = useBroadcastGraphicsPlayoutClock(
	() => props.screen.id,
	() => props.graphics,
	() => props.channels,
);
const onAirGraphicIds = computed(() => new Set(sessionStore.onAirGraphicIds(
	props.screen.id,
	props.graphics,
	playoutNow.value,
	props.channels,
)));

/** A placement is a new Broadcast Graphic, and the author is put straight on it. */
function selectPlacedGraphic(graphicId: string) {
	emit('update:selectedTarget', { type: 'graphic', graphicId });
}

/**
 * Fail closed: until a caller says this session holds the lease, the workspace is
 * an observer's. An unstated permission must never read as one that was granted.
 */
const holdsLease = computed(() => props.writable === true);

/**
 * A Template placement is in flight. The server is rewriting the stack and the
 * Screen is then reloaded, so an edit made meanwhile would be built on the stack
 * from before the placement and would write the placed Broadcast Graphic away.
 */
const placing = ref(false);

/** Whether this session may edit now: it holds the lease, and no placement is in flight. */
const canAuthor = computed(() => holdsLease.value && !placing.value);

/*
 * Copy and paste (#746): ⌘C and ⌘V copy the selected Graphic Item and paste it
 * into the selected Broadcast Graphic, on this Screen or another; ⌘⌥C and ⌘⌥V do
 * the same for its style. What is copied is kept in this browser. Copying is not
 * a write, so an observer may; pasting is, so only the lease holder does.
 */
const clipboard = useGraphicsClipboard('broadcast-graphics');
const selection = computed(() => resolveGraphicsSelection(props.graphics, props.selectedTarget));

function copy(style: boolean): boolean {
	const current = selection.value;
	if (current.kind !== 'item')
		return false;
	return style
		? clipboard.copyStyle(copyGraphicStyle('broadcast-graphics', current.item))
		: clipboard.copyLayers(copyGraphicLayers('broadcast-graphics', { composition: current.graphic }, [
				{ type: 'item', itemId: current.item.id },
			]));
}

/** Into the selected Broadcast Graphic, and into the Graphic Group the selection is or sits in. */
async function pasteLayers() {
	const copied = await clipboard.layersToPaste();
	const graphicId = graphicsSelectionGraphicId(props.selectedTarget);
	if (!copied || !canAuthor.value)
		return;
	const current = selection.value;
	const outcome = pasteBroadcastGraphicLayers(copied, { graphics: props.graphics, graphicId: graphicId ?? '' }, {
		groupId: current.kind === 'item'
			? current.group?.id ?? current.item.id
			: undefined,
		nextId: randomUuid,
	});
	if (!outcome.ok) {
		clipboard.refuse(outcome.refusal);
		return;
	}
	emit('update:graphics', outcome.graphics);
	const itemId = outcome.pasted.at(-1);
	if (graphicId && itemId)
		emit('update:selectedTarget', { type: 'item', graphicId, itemId });
}

async function pasteStyle() {
	const copied = await clipboard.styleToPaste();
	const current = selection.value;
	if (!copied || !canAuthor.value)
		return;
	if (current.kind !== 'item') {
		clipboard.refuse({ reason: 'no-destination' });
		return;
	}
	const outcome = pasteGraphicStyle(copied, 'broadcast-graphics', current.item);
	if (!outcome.ok) {
		clipboard.refuse(outcome.refusal);
		return;
	}
	emit('update:graphics', replaceBroadcastGraphic(props.graphics, replaceGraphicItemById(current.graphic, outcome.item)));
}

function handleKeydown(event: KeyboardEvent) {
	const mod = event.metaKey || event.ctrlKey;
	if (!mod || event.shiftKey || event.defaultPrevented || isTypingTarget(event.target))
		return;
	// By code: ⌥ changes the character a key types.
	if (event.code === 'KeyC' && !hasTextSelection()) {
		if (copy(event.altKey))
			event.preventDefault();
	}
	else if (event.code === 'KeyV' && canAuthor.value) {
		event.preventDefault();
		void (event.altKey
			? pasteStyle()
			: pasteLayers());
	}
}

useEventListener(import.meta.client
	? window
	: undefined, 'keydown', handleKeydown);
</script>

<template>
	<div>
		<GraphicsAuthoringLeaseNotice
			class="mb-4"
			:writable="holdsLease"
			:lease-status="leaseStatus"
			:can-take-over="canTakeOver"
			:holder-name="holderName"
			@take-over="emit('takeOver')"
		/>

		<GraphicsSaveState
			class="mb-2 justify-end"
			:save-state="saveState ?? 'idle'"
			:save-error="saveError"
			:writable="holdsLease"
			@retry="emit('retrySave')"
		/>

		<div class="grid min-h-[calc(100vh-18rem)] items-start gap-4 xl:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)_minmax(19rem,24rem)] 2xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)_minmax(24rem,30rem)]">
			<section class="min-w-0 rounded-lg border border-default/70 bg-default p-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
				<GraphicsCompositorStackTree
					:graphics="graphics"
					:selected-target="selectedTarget"
					:selected-graphic-id="selectedGraphicId"
					:contract="BROADCAST_GRAPHICS_HOST_CONTRACT"
					:canvas-width="canvasWidth"
					:canvas-height="canvasHeight"
					:writable="canAuthor"
					:theme-tokens="previewTheme.themeTokens.value"
					@update:graphics="emit('update:graphics', $event)"
					@update:selected-target="emit('update:selectedTarget', $event)"
				>
					<template #graphic-badge="{ graphic }">
						<!--
							Reconnect Resync's rule, applied to a badge: while the
							connection is down this client cannot know what is on air,
							so every graphic says so — a frozen or absent mark would
							read as "not on air" on exactly the surface guarding live
							edits.
						-->
						<UBadge
							v-if="playoutDisconnected"
							data-testid="graphic-playout-unknown"
							color="neutral"
							variant="outline"
							size="sm"
							icon="i-lucide-wifi-off"
							title="Disconnected: whether this graphic is on air cannot be known until the connection returns."
						>
							Playout unknown
						</UBadge>
						<UBadge
							v-else-if="onAirGraphicIds.has(graphic.id)"
							data-testid="graphic-on-air"
							color="error"
							variant="subtle"
							size="sm"
							icon="i-lucide-radio"
							title="This Broadcast Graphic is composing into a program output. An edit under a live On-air Update Policy reaches it immediately."
						>
							On air
						</UBadge>
					</template>
				</GraphicsCompositorStackTree>

				<!--
					Beside the stack, each a section that starts closed and says what it
					holds in one line, so the stack is what an author sees.
				-->
				<div class="mt-4 border-t border-default/70">
					<!--
						Graphic Channels sit beside the stack rather than in it: a lane decides
						which graphics replace each other on air, and never what composites over
						what.
					-->
					<ScreenModesBroadcastGraphicsChannels
						:graphics="graphics"
						:channels="channels"
						:writable="canAuthor"
						@update:channels="emit('update:channels', $event)"
					/>

					<!--
						The background sits beside the stack for the same reason the channels do:
						it is a Screen-level decision about the show, and changes nothing about
						any design or about Graphic Layer Order.
					-->
					<ScreenModesBroadcastGraphicsBackground
						:background="background"
						:writable="canAuthor"
						@update:background="emit('update:background', $event)"
					/>

					<!--
						The Broadcast Graphic Template library lives in the Edit workspace and
						nowhere else: saving and placing designs is authoring, and the Live
						workspace deliberately has no route to either.
					-->
					<GraphicsBroadcastGraphicTemplateLibrary
						v-model:placing="placing"
						:event-id="eventId"
						:screen-id="screen.id"
						:selected-graphic="selectedGraphic"
						:writable="holdsLease"
						:flush-edits="flushEdits"
						@placed="selectPlacedGraphic"
					/>
				</div>
			</section>

			<section class="min-w-0 xl:sticky xl:top-4">
				<GraphicsPreviewThemePicker
					v-model="previewTheme.choice.value"
					class="mb-2"
					:items="previewTheme.items.value"
				/>
				<GraphicsCompositorPreview
					:event-id="eventId"
					:screen="screen"
					:graphics="graphics"
					:selected-target="selectedTarget"
					:canvas-width="canvasWidth"
					:canvas-height="canvasHeight"
					:preview-theme-values="previewTheme.previewThemeValues.value"
					@select-target="emit('update:selectedTarget', $event)"
				/>
			</section>

			<section class="min-w-0 rounded-lg border border-default/70 bg-default p-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
				<GraphicsCompositorInspector
					:graphics="graphics"
					:selected-target="selectedTarget"
					:contract="BROADCAST_GRAPHICS_HOST_CONTRACT"
					:canvas-width="canvasWidth"
					:canvas-height="canvasHeight"
					:event-id="eventId"
					:game="game"
					:writable="canAuthor"
					:theme-tokens="previewTheme.themeTokens.value"
					@update:graphics="emit('update:graphics', $event)"
				/>
			</section>
		</div>
	</div>
</template>
