<script setup lang="ts">
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { Screen } from '~/types';
import { screenOutputPath } from '~~/shared/utils/screenOutput';

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
 * Both actions stay available in every state: they are idempotent target-state
 * commands, so pressing Take on a graphic that is already on air is a harmless
 * restatement of the same intent rather than a second take. Cut variants reach
 * the same target without running the corresponding Graphic Animation phase,
 * which is indistinguishable from the plain action until animation exists.
 *
 * Take is the one action a broken Graphic Asset Reference withholds. Out stays
 * available in every state, because a graphic already on air whose media has just
 * gone missing is exactly the graphic an operator most needs to remove.
 *
 * Generated Live Control per placed graphic — source pickers and typed input
 * fields — arrives with the Graphic Input work.
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

function take(graphicId: string, cut: boolean) {
	void sessionStore.take(props.eventId, props.screen.id, graphicId, cut);
}

function out(graphicId: string, cut: boolean) {
	void sessionStore.out(props.eventId, props.screen.id, graphicId, cut);
}

// Realtime messages only announce that playout moved on; this is the authority
// they point at, so the workspace loads it on arrival and after a Screen change.
watch(
	() => [props.eventId, props.screen.id] as const,
	([eventId, screenId]) => {
		void sessionStore.loadSession(eventId, screenId);
	},
	{ immediate: true },
);
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
								:disabled="entry.pending || entry.assetBlockedReason !== undefined"
								data-testid="playout-take"
								@click="take(entry.graphic.id, false)"
							>
								Take
							</UButton>
							<UButton
								color="primary"
								variant="outline"
								aria-label="Cut Take"
								:disabled="entry.pending || entry.assetBlockedReason !== undefined"
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
								:disabled="entry.pending"
								data-testid="playout-out"
								@click="out(entry.graphic.id, false)"
							>
								Out
							</UButton>
							<UButton
								color="neutral"
								variant="outline"
								aria-label="Cut Out"
								:disabled="entry.pending"
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
	</div>
</template>
