<script setup lang="ts">
import type {
	BroadcastGraphicConfig,
	GraphicChannelConfig,
	GraphicChannelHandoffPolicy,
	GraphicPlayoutState,
} from '~~/shared/types/graphics';
import type { Screen } from '~/types';
import { graphicChannelGroups, graphicChannelHandoffPolicy } from '~~/shared/modules/graphics';
import { LazyUIConfirmActionModal } from '#components';

/**
 * The Live workspace of a Broadcast Graphics Screen, and the workspace the
 * Screen configuration page opens on.
 *
 * The Program monitor it operates beside is not here: it is hoisted above the
 * workspace switch, one persistent instance in both workspaces (story 23, #335),
 * and this component's cards join it in the parent's grid. Its stack lists every
 * placed Broadcast Graphic with the Graphic Playout State the Broadcast Graphics
 * Live Session says it has, and Take and Out state the operator's latest intent
 * for one graphic.
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
	/** The Screen's Graphic Channels, which the rundown is organised by. */
	channels?: readonly GraphicChannelConfig[];
	selectedGraphicId: string | null;
	canvasWidth: number;
	canvasHeight: number;
}>();

const emit = defineEmits<{ select: [graphicId: string] }>();

const sessionStore = useBroadcastGraphicsLiveSessionStore();

/**
 * The one authoritative instant everything below is projected at — this
 * workspace's own playout clock, advanced from the same authoritative serverNow
 * the Program monitor beside it derives from.
 */
const now = useBroadcastGraphicsPlayoutClock(
	() => props.screen.id,
	() => props.graphics,
	() => props.channels,
);

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

/**
 * The two Graphic Asset failures, named once for both surfaces that report them.
 *
 * The check made before Take is sent and the authority's own refusal are the same
 * fact about the same Graphic Asset Reference, seen a moment apart — the second is
 * what the first misses in the residual race. Reading as two different failures
 * would make the rarer one, which is the one that reaches an operator mid-show,
 * the one they have never seen the words for.
 */
const ASSET_REFUSAL_TITLES = {
	missing: 'Missing Graphic Asset Reference',
	unavailable: 'Unavailable Graphic Asset Content',
} as const;

const ASSET_REFUSAL_ALERTS: Record<'missing' | 'unavailable', {
	title: string;
	color: 'error' | 'warning';
}> = {
	// Repair or replace it; retrying is the one thing that provably cannot work.
	missing: { title: ASSET_REFUSAL_TITLES.missing, color: 'error' },
	// The bytes come back, so this one is worth trying again.
	unavailable: { title: ASSET_REFUSAL_TITLES.unavailable, color: 'warning' },
};

/**
 * How this Screen's last unsuccessful playout action reads to an operator.
 *
 * A refusal is not a failure of the action, and titling it as one told the operator
 * the wrong thing twice over: "Playout action failed" over a transport status line
 * says only that something went wrong, while the authority had written a sentence
 * naming the very Graphic Asset Reference that has to be repaired (#230). So a
 * refusal is titled by what it is, and carries the sentence the authority wrote.
 *
 * A refusal outside the Graphic Asset vocabulary — a superseded acceptance, a
 * required Graphic Input with no value — is still the authority answering rather
 * than a fault, and its own sentence already names the thing. It is titled as a
 * refusal without being given a third set of words for a fault it is not.
 *
 * What keeps "failed" is everything with no refusal code at all, and nothing refused
 * those — so "failed" is what they are: an action this client could not complete.
 * What #245 changed is how well they say it. `failureSentence` lifts a sub-500 body's
 * sentence into `error`, so "the Screen is not in Broadcast Graphics mode" and "the
 * live session has ended" now explain themselves in the authority's own words where
 * they used to arrive as a transport status line, and the title above them is the
 * same either way. Deliberately: writing `refusal` for these to title them apart
 * would undo #230's separation of *having a sentence* from *being a recognised
 * refusal*, which is the distinction the whole vocabulary rests on.
 *
 * Whether an authority's sentence should ever carry a title of its own is a real
 * question and not one this component can answer — `error` is a single string, and a
 * title chosen by sniffing its shape for a status line would be a worse lie than a
 * coarse one. That needs a signal from the store, and is tracked separately at round
 * close rather than decided here.
 *
 * A field-scoped refusal is reported here as well as against its own field. That is
 * deliberate: Live Control renders only for the selected Broadcast Graphic, so an
 * operator who has selected nothing — or another graphic — would otherwise watch a
 * media selection fail in silence. The field keeps the better report, naming the
 * choice; this one exists so there is always some report.
 */
const playoutFailure = computed(() => {
	if (!sessionStore.error)
		return null;

	const outcome = sessionStore.refusal ? graphicAssetRefusalOutcome(sessionStore.refusal.code) : undefined;
	if (outcome)
		return { ...ASSET_REFUSAL_ALERTS[outcome], icon: 'i-lucide-image-off', description: sessionStore.error };
	if (sessionStore.refusal) {
		return {
			title: 'Playout action refused',
			color: 'warning' as const,
			icon: 'i-lucide-triangle-alert',
			description: sessionStore.error,
		};
	}
	return {
		title: 'Playout action failed',
		color: 'error' as const,
		icon: 'i-lucide-triangle-alert',
		description: sessionStore.error,
	};
});

const PLAYOUT_STATE_LABELS: Record<GraphicPlayoutState, string> = {
	'off': 'Off',
	'waiting': 'Waiting',
	'entering': 'Entering',
	'on-air': 'On air',
	'updating': 'Updating',
	'exiting': 'Exiting',
};

const PLAYOUT_STATE_COLORS: Record<GraphicPlayoutState, 'neutral' | 'warning' | 'error'> = {
	'off': 'neutral',
	'waiting': 'warning',
	'entering': 'error',
	'on-air': 'error',
	'updating': 'error',
	'exiting': 'error',
};

const HANDOFF_POLICY_LABELS: Record<GraphicChannelHandoffPolicy, string> = {
	'overlap': 'Overlap',
	'out-then-in': 'Out then in',
};

const channelContexts = computed(() => sessionStore.channelContexts(props.graphics, props.channels));

/** Every placed Broadcast Graphic's row, looked up by id. Order belongs to `groups`. */
const entries = computed(() => props.graphics.map(graphic => ({
	graphic,
	playoutState: sessionStore.playoutState(
		props.screen.id,
		graphic.id,
		graphic,
		now.value,
		channelContexts.value[graphic.id],
	),
	// Scoped per graphic: an action on one must never freeze another's controls.
	pending: sessionStore.isPending(props.screen.id, graphic.id),
	assetBlockedReason: takeBlockedReason(graphic.id),
	assetRetryable: assetContentRetryable(graphic.id),
})));

/**
 * The rundown, organised by Graphic Channel.
 *
 * Grouping is a reading of the stack rather than a reordering of it: within a group
 * the graphics stay in authored Screen stack order, front first, exactly as the flat
 * list has them — Graphic Channel membership never changes what composites over what.
 * What grouping buys an operator is that the graphics competing for one lane sit
 * together under the Graphic Channel Handoff Policy that decides how they replace
 * each other.
 */
const groups = computed(() => {
	const byId = new Map(entries.value.map(entry => [entry.graphic.id, entry]));
	return graphicChannelGroups({ graphics: props.graphics, channels: props.channels }).map(group => ({
		key: group.channel?.id ?? '',
		channel: group.channel,
		policy: HANDOFF_POLICY_LABELS[graphicChannelHandoffPolicy(group.channel ?? undefined)],
		entries: [...group.graphics].reverse().map(graphic => byId.get(graphic.id)!),
	}));
});

/**
 * Headings only once a Graphic Channel actually organises something. A Screen with
 * no channels is one lane, and labelling every graphic "No channel" would be noise.
 */
const organised = computed(() => groups.value.some(group => group.channel !== null));

const onAirCount = computed(() =>
	sessionStore.onAirGraphicIds(props.screen.id, props.graphics, now.value, props.channels).length,
);

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
	<!--
		`contents`, not a grid of its own: these cards are laid out by the parent's
		grid, beside the hoisted Program monitor that fills its first cell (#335).
	-->
	<div class="contents">
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
					know that what they asked for is not what program is showing — and,
					when the authority said why, what it said.
				-->
				<UAlert
					v-if="playoutFailure"
					data-testid="playout-error"
					:color="playoutFailure.color"
					variant="soft"
					:icon="playoutFailure.icon"
					:title="playoutFailure.title"
					:description="playoutFailure.description"
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
					v-for="group in groups"
					:key="group.key"
					class="space-y-2"
					:data-playout-channel="group.channel?.id ?? ''"
				>
					<!--
						A Graphic Channel holds at most one of its members on air, so the
						operator reads the lane and the rule that governs it above the graphics
						competing for it. Grouping never reorders the stack.
					-->
					<div
						v-if="organised"
						class="flex items-baseline gap-2 pt-1"
						data-testid="playout-channel-heading"
					>
						<span class="min-w-0 flex-1 truncate text-xs font-medium">
							{{ group.channel?.name ?? 'No Graphic Channel' }}
						</span>
						<UBadge
							v-if="group.channel"
							size="xs"
							color="neutral"
							variant="outline"
							class="shrink-0"
							data-testid="playout-channel-policy"
						>
							{{ group.policy }}
						</UBadge>
					</div>

					<div
						v-for="entry in group.entries"
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
							<!--
								An operator has to be able to tell a graphic that is on program from
								one that is on its way there or away, so every lifecycle phase reads as
								itself. Anything on program is red; off is neutral; and waiting is
								neither — it is the operator's latest selection for its Graphic
								Channel while being absent from every output, so reading it as on
								program would be the one wrong thing this badge could say.
							-->
							<UBadge
								size="xs"
								:color="PLAYOUT_STATE_COLORS[entry.playoutState]"
								variant="soft"
								class="shrink-0"
							>
								{{ PLAYOUT_STATE_LABELS[entry.playoutState] }}
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
							:title="entry.assetRetryable ? ASSET_REFUSAL_TITLES.unavailable : ASSET_REFUSAL_TITLES.missing"
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
			</div>
		</ScreenSettingsCard>

		<ScreenModesBroadcastGraphicsLiveControl
			v-if="selectedEntry"
			:event-id="eventId"
			:screen="screen"
			:graphic="selectedEntry.graphic"
			:playout-state="selectedEntry.playoutState"
			:now="now"
			:pending="selectedEntry.pending"
			:disconnected="disconnected"
		/>
	</div>
</template>
