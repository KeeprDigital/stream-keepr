<script setup lang="ts">
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { Screen } from '~/types';
import { screenOutputPath } from '~~/shared/utils/screenOutput';
import { LazyUIConfirmActionModal } from '#components';

/**
 * The Live workspace of a Broadcast Graphics Screen, and the workspace the
 * Screen configuration page opens on.
 *
 * Its Program monitor is the authoritative Overlay Output itself, not a preview,
 * so it carries no editor guides — and, being a real output, it needs a Screen
 * Output Asset Capability to resolve its media at all. Its stack lists every placed Broadcast Graphic
 * with the Graphic Playout State the Broadcast Graphics Live Session says it has,
 * and Take and Out state the operator's latest intent for one graphic.
 *
 * Both actions stay available in every playout state: they are idempotent
 * target-state commands, so pressing Take on a graphic that is already on air is a
 * harmless restatement of the same intent rather than a second take. Cut variants
 * reach the same target without running the corresponding Graphic Animation phase,
 * which is indistinguishable from the plain action until animation exists.
 *
 * Take is the one action a broken Graphic Asset Reference withholds. Out stays
 * available in every playout state, because a graphic already on air whose media
 * has just gone missing is exactly the graphic an operator most needs to remove.
 *
 * A disconnection withholds every action, and that is not the same kind of rule.
 * The others are about the show; this one is about this browser having no way to
 * reach the authoritative order. Nothing is queued for reconnection: a playout
 * intent is a statement about what should be on air *now*, so replaying one formed
 * during an outage would put a graphic on program that the operator decided about
 * minutes ago and has since watched not happen.
 *
 * Generated Live Control for the selected Broadcast Graphic sits alongside the
 * stack: typed fields for its declared Graphic Inputs, the value trace behind each
 * of them, and Update Graphic while it is on air. Graphic Source Selection pickers
 * arrive with Event Data binding.
 */
const props = defineProps<{
	eventId: number;
	screen: Screen;
	graphics: readonly BroadcastGraphicConfig[];
	selectedGraphicId: string | null;
	canvasWidth: number;
	canvasHeight: number;
}>();

const emit = defineEmits<{ select: [graphicId: string] }>();

const sessionStore = useBroadcastGraphicsLiveSessionStore();

/**
 * The Program monitor is the authoritative Overlay Output itself, so it resolves
 * media exactly as a capture browser does — through a Screen Output Asset
 * Capability. Without one it would show every graphic except its media, which is
 * the one thing a monitor must not do quietly.
 */
const { assetCapability } = useScreenOutputAssetCapability(
	() => props.eventId,
	() => props.screen.id,
);

const programUrl = computed(() => screenOutputPath({
	eventId: props.eventId,
	screenSlug: props.screen.slug,
	output: 'overlay',
	fitToViewport: true,
	assetCapability: assetCapability.value,
}));
const programAspectStyle = computed(() => ({
	aspectRatio: `${props.canvasWidth} / ${props.canvasHeight}`,
	maxHeight: '46vh',
}));

/**
 * The stack an operator reads top to bottom, front Broadcast Graphic first.
 *
 * Authored order is back to front, so the list is reversed for display only;
 * nothing about composition order changes.
 */
/**
 * A Missing Graphic Asset Reference invalidates the Broadcast Graphic that owns
 * it, so that graphic cannot be taken on air — and the reason is stated against
 * the graphic rather than hidden behind a disabled button.
 */
const {
	takeBlockedReason,
	retryable: assetContentRetryable,
	retry: retryAssetContent,
} = useBroadcastGraphicsAssetEligibility(() => props.graphics);

const entries = computed(() => [...props.graphics].reverse().map(graphic => ({
	graphic,
	playoutState: sessionStore.playoutState(props.screen.id, graphic.id),
	// Scoped per graphic: an action on one must never freeze another's controls.
	pending: sessionStore.isPending(props.screen.id, graphic.id),
	assetBlockedReason: takeBlockedReason(graphic.id),
	assetRetryable: assetContentRetryable(graphic.id),
})));

const onAirCount = computed(() => sessionStore.onAirGraphicIds(props.screen.id, props.graphics).length);

/**
 * The Broadcast Graphic whose Live Control is shown. An operator working a stack
 * controls one graphic at a time, and the stack list is where they choose it.
 */
const selectedEntry = computed(() =>
	entries.value.find(entry => entry.graphic.id === props.selectedGraphicId) ?? null,
);

function take(graphicId: string, cut: boolean) {
	void sessionStore.take(props.eventId, props.screen.id, graphicId, cut);
}

function out(graphicId: string, cut: boolean) {
	void sessionStore.out(props.eventId, props.screen.id, graphicId, cut);
}

/**
 * Realtime messages only announce that playout moved on; the snapshot is the
 * authority they point at. The workspace loads it on arrival, after a Screen
 * change, and again on reconnection — a notification published while this client
 * was away never arrives late, so reconnecting is the only thing that can tell it
 * what it missed.
 */
const { disconnected } = useBroadcastGraphicsLiveSessionSync(
	() => props.eventId,
	() => props.screen.id,
);

/**
 * Why this Screen's durable live state could not be read, when it could not.
 *
 * Prominent and not dismissible: nothing is on air, every output is transparent,
 * and no amount of waiting changes that — only an explicit Take, which is the one
 * thing an operator will not think to try unless told.
 */
const recoveryFault = computed(() => sessionStore.recoveryFault(props.screen.id));

const resettingLiveState = ref(false);
const overlay = useOverlay();

/**
 * Confirmed, because it is the one operator action that both blanks program and
 * throws away staged work — and it is offered next to the recovery fault it is the
 * answer to.
 */
async function resetLiveState() {
	const modal = overlay.create(LazyUIConfirmActionModal);
	const confirmed = await modal.open({
		title: 'Reset live state',
		message: 'Take every Broadcast Graphic off air and start a new Broadcast Graphics Live Session?',
		description: 'Prepared Graphic Input values are discarded, and commands from the current session stop being accepted.',
		confirmLabel: 'Reset live state',
		confirmColor: 'error',
		icon: 'i-lucide-rotate-ccw',
		iconColor: 'text-error',
	}).result;

	if (!confirmed)
		return;

	resettingLiveState.value = true;
	try {
		await sessionStore.resetLiveState(props.eventId, props.screen.id);
	}
	finally {
		resettingLiveState.value = false;
	}
}
</script>

<template>
	<div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,24rem)]">
		<ScreenSettingsCard title="Program" :default-open="true">
			<div class="transparent-checkerboard-backdrop overflow-hidden rounded-md">
				<div class="relative mx-auto w-full" :style="programAspectStyle">
					<iframe
						:src="programUrl"
						class="absolute inset-0 size-full border-0"
						title="Broadcast Graphics program monitor"
						data-testid="program-monitor"
					/>
				</div>
			</div>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="On air" :default-open="true">
			<UIEmptyState
				v-if="graphics.length === 0"
				icon="i-lucide-layers"
				title="No Broadcast Graphics"
				description="Compose a Broadcast Graphic in the Edit workspace."
			/>
			<div v-else class="space-y-2">
				<p class="text-xs text-muted" data-testid="on-air-count">
					{{ onAirCount }} of {{ graphics.length }} on air
				</p>

				<!--
					Durable live state that could not be read: nothing is on air anywhere,
					and only an explicit Take puts anything back. Stated first, because
					every other reading of this panel is wrong until the operator knows it.
				-->
				<UAlert
					v-if="recoveryFault"
					data-testid="playout-recovery-fault"
					color="error"
					variant="solid"
					icon="i-lucide-shield-alert"
					title="Live state could not be recovered"
					:description="`Every Broadcast Graphic is off and every output is transparent because ${recoveryFault.detail}. Take the graphics this show needs to put them back on air.`"
				/>

				<!--
					A disconnected Live Control is not a Live Control: what it shows is as
					old as the disconnection, and nothing it sends can be accepted. It says
					so and withholds its actions rather than queueing them for later — a
					playout intent formed minutes ago is not one an operator still wants.
				-->
				<UAlert
					v-if="disconnected"
					data-testid="playout-disconnected"
					color="warning"
					variant="soft"
					icon="i-lucide-wifi-off"
					title="Disconnected"
					description="Playout actions are unavailable until the connection returns. Nothing is queued; this panel reloads the authoritative state on reconnection."
				/>

				<!--
					A rejected playout action must never be invisible: the operator has to
					know that what they asked for is not what program is showing.
				-->
				<UAlert
					v-if="sessionStore.error"
					data-testid="playout-error"
					color="error"
					variant="soft"
					icon="i-lucide-triangle-alert"
					title="Playout action failed"
					:description="sessionStore.error"
				/>

				<UButton
					size="xs"
					color="error"
					variant="subtle"
					icon="i-lucide-rotate-ccw"
					block
					:loading="resettingLiveState"
					:disabled="disconnected"
					data-testid="playout-reset-live-state"
					@click="resetLiveState"
				>
					Reset live state
				</UButton>

				<div
					v-for="entry in entries"
					:key="entry.graphic.id"
					class="rounded-lg border p-3 transition"
					:class="selectedGraphicId === entry.graphic.id ? 'border-primary bg-primary/10' : 'border-default/70 bg-muted/20'"
					:data-playout-entry="entry.graphic.id"
					:data-playout-state="entry.playoutState"
				>
					<button
						type="button"
						class="flex w-full items-start gap-3 text-left"
						data-testid="playout-select"
						@click="emit('select', entry.graphic.id)"
					>
						<UIcon name="i-lucide-layers" class="mt-0.5 size-4 shrink-0 text-muted" />
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium">{{ entry.graphic.name }}</span>
							<span class="mt-0.5 block truncate text-xs text-muted">{{ entry.graphic.items.length }} items</span>
						</span>
						<UBadge
							size="xs"
							:color="entry.playoutState === 'on-air' ? 'error' : 'neutral'"
							variant="soft"
							class="shrink-0"
						>
							{{ entry.playoutState === 'on-air' ? 'On air' : 'Off' }}
						</UBadge>
					</button>

					<!--
						Diagnosable, not merely blocked: the alert names the owner slot the
						author has to repair, and offers a retry only for content that could
						come back.
					-->
					<UAlert
						v-if="entry.assetBlockedReason"
						class="mt-2"
						:data-testid="`playout-asset-blocked-${entry.graphic.id}`"
						:color="entry.assetRetryable ? 'warning' : 'error'"
						variant="soft"
						icon="i-lucide-image-off"
						:title="entry.assetRetryable ? 'Unavailable Graphic Asset Content' : 'Missing Graphic Asset Reference'"
						:description="entry.assetBlockedReason"
					/>
					<UButton
						v-if="entry.assetRetryable"
						class="mt-2"
						size="xs"
						color="warning"
						variant="soft"
						icon="i-lucide-refresh-cw"
						data-testid="playout-retry-asset-content"
						@click="retryAssetContent"
					>
						Retry Graphic Asset Content
					</UButton>

					<div class="mt-2 flex gap-1.5">
						<UFieldGroup size="xs" class="flex-1">
							<UButton
								color="primary"
								variant="subtle"
								class="flex-1 justify-center"
								:disabled="disconnected || entry.pending || entry.assetBlockedReason !== undefined"
								data-testid="playout-take"
								@click="take(entry.graphic.id, false)"
							>
								Take
							</UButton>
							<UButton
								color="primary"
								variant="outline"
								aria-label="Cut Take"
								:disabled="disconnected || entry.pending || entry.assetBlockedReason !== undefined"
								title="Take without its enter animation"
								data-testid="playout-cut-take"
								@click="take(entry.graphic.id, true)"
							>
								Cut
							</UButton>
						</UFieldGroup>

						<UFieldGroup size="xs" class="flex-1">
							<UButton
								color="neutral"
								variant="subtle"
								class="flex-1 justify-center"
								:disabled="disconnected || entry.pending"
								data-testid="playout-out"
								@click="out(entry.graphic.id, false)"
							>
								Out
							</UButton>
							<UButton
								color="neutral"
								variant="outline"
								aria-label="Cut Out"
								:disabled="disconnected || entry.pending"
								title="Out without its exit animation"
								data-testid="playout-cut-out"
								@click="out(entry.graphic.id, true)"
							>
								Cut
							</UButton>
						</UFieldGroup>
					</div>
				</div>
			</div>
		</ScreenSettingsCard>

		<ScreenModesBroadcastGraphicsLiveControl
			v-if="selectedEntry"
			:event-id="eventId"
			:screen="screen"
			:graphic="selectedEntry.graphic"
			:playout-state="selectedEntry.playoutState"
			:pending="selectedEntry.pending"
			:disconnected="disconnected"
		/>
	</div>
</template>
