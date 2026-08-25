<script setup lang="ts">
import type { AnimationEffectSelection, BroadcastGraphicsBackgroundConfig } from '~~/shared/animationEffects';
import { parseBroadcastGraphicsBackgroundConfig } from '~~/shared/animationEffects';
import { DEFAULT_BROADCAST_GRAPHICS_BACKGROUND } from '~~/shared/types/screenConfig';

/**
 * Authoring for a Broadcast Graphics Screen's background: which Animation Effect
 * the Screen's stack composes over, whether it shows, and at what opacity.
 *
 * It sits beside the stack rather than in it, for the reason Graphic Channels do:
 * a background is a Screen-level decision about the show and changes nothing
 * about any design or about Graphic Layer Order. It lives in the Edit workspace
 * because it is authoring, and so is covered by the same Graphics Authoring Lease
 * every other control there is — an observer reads the background without being
 * able to change it.
 *
 * The effect select and its per-effect params are the shared Animation Effect
 * fields, exactly as the Feature Match Overlay Frame's are; what this host adds
 * around the selection is the two fields below and nothing else.
 */
const props = defineProps<{
	background?: BroadcastGraphicsBackgroundConfig;
	/** Whether this session currently holds the workspace's Graphics Authoring Lease. */
	writable?: boolean;
}>();

const emit = defineEmits<{
	'update:background': [background: BroadcastGraphicsBackgroundConfig];
}>();

const canAuthor = computed(() => props.writable === true);

/**
 * The background this card edits: the stored one when this build can render it,
 * and the shipped default when it cannot.
 *
 * The parse decides *which of the two*, and its result is then deliberately
 * discarded in favour of the stored value as authored — because parsing fills
 * every param from its effect's schema, and writing that completed bag back would
 * pin today's defaults into the document. A sparse bag stays sparse; a config
 * naming an effect this build does not ship starts over rather than being carried
 * into the next write (the vocabulary refusal, in the editor, on the Frame's
 * precedent).
 */
const background = computed<BroadcastGraphicsBackgroundConfig>(() =>
	parseBroadcastGraphicsBackgroundConfig(props.background)
		? props.background!
		: DEFAULT_BROADCAST_GRAPHICS_BACKGROUND,
);

function write(next: BroadcastGraphicsBackgroundConfig) {
	if (!canAuthor.value)
		return;
	emit('update:background', next);
}

function updateEnabledOrOpacity(updates: Partial<Pick<BroadcastGraphicsBackgroundConfig, 'enabled' | 'opacity'>>) {
	write({ ...background.value, ...updates });
}

/**
 * The shared fields own effect switching and param coercion — switching effect
 * starts from that effect's schema defaults — so this host puts its own two
 * fields back around whatever selection they hand over.
 */
function applySelection(selection: AnimationEffectSelection) {
	write({
		enabled: background.value.enabled,
		opacity: background.value.opacity,
		...selection,
	} as BroadcastGraphicsBackgroundConfig);
}

const selection = computed<AnimationEffectSelection>(() => ({
	effect: background.value.effect,
	params: background.value.params,
} as AnimationEffectSelection));
</script>

<template>
	<section data-testid="broadcast-graphics-background-settings">
		<h3 class="mb-2 text-sm font-medium">
			Background
		</h3>

		<p class="mb-2 text-xs text-muted">
			One Animation Effect behind every Broadcast Graphic on this Screen. It renders in
			the Overlay and Fill Outputs and never in the Key Output, which stays an alpha
			matte.
		</p>

		<fieldset :disabled="!canAuthor" class="space-y-3">
			<ScreenSettingsToggle
				label="Animated background"
				:model-value="background.enabled"
				@update:model-value="updateEnabledOrOpacity({ enabled: $event })"
			/>

			<template v-if="background.enabled">
				<UFormField label="Opacity" data-testid="broadcast-graphics-background-opacity">
					<UInputNumber
						:model-value="background.opacity"
						:step="0.05"
						:min="0"
						:max="1"
						size="sm"
						class="w-full"
						@update:model-value="updateEnabledOrOpacity({ opacity: Number($event) })"
					/>
				</UFormField>

				<ScreenAnimationEffectFields
					:selection="selection"
					@update:selection="applySelection"
				/>
			</template>
		</fieldset>
	</section>
</template>
