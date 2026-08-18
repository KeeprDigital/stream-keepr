<script setup lang="ts">
import type {
	BroadcastGraphicConfig,
	SocialProfileProjectionDeclaration,
	SocialProfileTransition,
} from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import {
	addSocialProfileProjection,
	associateSocialProfileProjection,
	deleteSocialProfileProjection,
	graphicInputKeyFromLabel,
	patchSocialProfileProjection,
	replaceBroadcastGraphic,
	socialProfileProjectionConsumerIds,
} from '~~/shared/modules/graphics';
import {
	MAX_GRAPHIC_INPUT_LABEL_LENGTH,
	MAX_SOCIAL_PROFILE_DWELL_MS,
	MAX_SOCIAL_PROFILE_TRANSITION_DURATION_MS,
	MIN_SOCIAL_PROFILE_DWELL_MS,
	MIN_SOCIAL_PROFILE_TRANSITION_DURATION_MS,
	SOCIAL_PROFILE_TRANSITION_VALUES,
} from '~~/shared/types/graphics';
import { randomUuid } from '~~/shared/utils/uuid';
import { resolveGraphicsSelection } from '~/modules/graphics/selection';

/**
 * The projection-specific authoring surface of the Broadcast Graphics compositor.
 *
 * Projections are not Graphic Inputs: their correlated values are read-only and
 * transition as one Presentation Group. This panel owns only that declaration;
 * its group and children remain ordinary items everywhere else in the compositor.
 */
const props = defineProps<{
	graphics: readonly BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	canvasWidth: number;
	canvasHeight: number;
	writable?: boolean;
}>();

const emit = defineEmits<{ 'update:graphics': [graphics: BroadcastGraphicConfig[]] }>();
const canAuthor = computed(() => props.writable === true);
const selection = computed(() => resolveGraphicsSelection(props.graphics, props.selectedTarget));
const selectedGraphic = computed(() => selection.value.kind === 'graphic' ? selection.value.graphic : null);
const projections = computed(() => selectedGraphic.value?.socialProfileProjections ?? []);
const talentSources = computed(() => (selectedGraphic.value?.sources ?? []).filter(source => source.kind === 'talent'));

const sourceOptions = computed(() => talentSources.value.map(source => ({
	label: source.from
		? `${source.label} (${source.from.relation === 'commentator1' ? 'Event Talent 1' : source.from.relation === 'commentator2' ? 'Event Talent 2' : 'derived'})`
		: `${source.label} (operator selected)`,
	value: source.key,
})));

const eligibleGroups = computed(() => {
	const assigned = new Set(projections.value.map(projection => projection.presentationGroupId));
	return (selectedGraphic.value?.items ?? [])
		.filter(item => item.type === 'group' && !assigned.has(item.id))
		.map(item => ({ label: item.label, value: item.id }));
});
const groupOptions = computed(() => [
	{ label: 'Create starter Presentation Group', value: '' },
	...eligibleGroups.value,
]);

const newLabel = ref('Social Profile 1');
const newSourceKey = ref('');
const newGroupId = ref('');

watch(talentSources, (sources) => {
	if (!sources.some(source => source.key === newSourceKey.value))
		newSourceKey.value = sources[0]?.key ?? '';
}, { immediate: true });

function replace(graphic: BroadcastGraphicConfig) {
	emit('update:graphics', replaceBroadcastGraphic(props.graphics, graphic));
}

function addProjection() {
	const graphic = selectedGraphic.value;
	if (!canAuthor.value || !graphic || newLabel.value.trim() === '' || newSourceKey.value === '')
		return;
	const projectionKey = graphicInputKeyFromLabel(
		newLabel.value,
		(graphic.socialProfileProjections ?? []).map(projection => projection.key),
	);
	const updated = newGroupId.value
		? associateSocialProfileProjection(graphic, {
				label: newLabel.value,
				projectionKey,
				sourceKey: newSourceKey.value,
				presentationGroupId: newGroupId.value,
			})
		: addSocialProfileProjection(graphic, {
				label: newLabel.value,
				projectionKey,
				sourceKey: newSourceKey.value,
				presentationGroupId: randomUuid(),
				iconItemId: randomUuid(),
				handleItemId: randomUuid(),
				canvasWidth: props.canvasWidth,
				canvasHeight: props.canvasHeight,
			});
	if (updated === graphic)
		return;
	replace(updated);
	newLabel.value = `Social Profile ${(updated.socialProfileProjections?.length ?? 0) + 1}`;
	newGroupId.value = '';
}

function patchProjection(key: string, patch: Partial<Omit<SocialProfileProjectionDeclaration, 'key'>>) {
	const graphic = selectedGraphic.value;
	if (!canAuthor.value || !graphic)
		return;
	const updated = patchSocialProfileProjection(graphic, key, patch);
	if (updated !== graphic)
		replace(updated);
}

function removeProjection(key: string, deletePresentationGroup: boolean) {
	const graphic = selectedGraphic.value;
	if (!canAuthor.value || !graphic)
		return;
	const updated = deleteSocialProfileProjection(graphic, key, { deletePresentationGroup });
	if (updated !== graphic)
		replace(updated);
}

function consumerCount(key: string) {
	return selectedGraphic.value ? socialProfileProjectionConsumerIds(selectedGraphic.value, key).length : 0;
}

const TRANSITION_LABELS: Record<SocialProfileTransition, string> = {
	'cut': 'Cut',
	'crossfade': 'Crossfade',
	'slide-left': 'Slide Left',
	'slide-right': 'Slide Right',
	'slide-up': 'Slide Up',
	'slide-down': 'Slide Down',
};
const transitionOptions = SOCIAL_PROFILE_TRANSITION_VALUES.map(value => ({ label: TRANSITION_LABELS[value], value }));
</script>

<template>
	<section v-if="selectedGraphic" class="space-y-3 rounded-lg border border-default/70 p-3" data-testid="social-profile-projections">
		<div>
			<p class="text-sm font-semibold">
				Social Profile Projections
			</p>
			<p class="text-xs text-muted">
				Read-only correlated profile values presented through ordinary Graphic Groups.
			</p>
		</div>

		<div v-if="canAuthor" class="space-y-2 rounded-lg border border-default/70 p-2" data-testid="social-profile-projection-new">
			<UFormField label="Label" size="xs" data-testid="social-profile-projection-label-new">
				<UInput
					v-model="newLabel"
					:maxlength="MAX_GRAPHIC_INPUT_LABEL_LENGTH"
					class="w-full"
					size="sm"
				/>
			</UFormField>
			<UFormField label="Talent source" size="xs" data-testid="social-profile-projection-source-new">
				<USelect
					v-model="newSourceKey"
					:items="sourceOptions"
					value-key="value"
					class="w-full"
					size="sm"
				/>
			</UFormField>
			<UFormField label="Presentation Group" size="xs" data-testid="social-profile-projection-group-new">
				<USelect
					v-model="newGroupId"
					:items="groupOptions"
					value-key="value"
					class="w-full"
					size="sm"
				/>
			</UFormField>
			<p v-if="talentSources.length === 0" class="text-xs text-warning" data-testid="social-profile-projection-no-talent-source">
				Declare a Talent Graphic Source Selection first. It may be operator selected or derived from Event Talent 1 or Talent 2.
			</p>
			<UButton
				size="sm"
				variant="soft"
				icon="i-lucide-plus"
				:disabled="talentSources.length === 0 || newLabel.trim() === ''"
				data-testid="social-profile-projection-add"
				@click="addProjection"
			>
				Declare projection
			</UButton>
		</div>

		<div
			v-for="projection in projections"
			:key="projection.key"
			class="space-y-2 rounded-lg border border-default/70 p-2"
			:data-social-profile-projection="projection.key"
		>
			<div class="flex items-center gap-2">
				<UInput
					:model-value="projection.label"
					class="min-w-0 flex-1"
					size="sm"
					:disabled="!canAuthor"
					data-testid="social-profile-projection-label"
					@update:model-value="patchProjection(projection.key, { label: String($event) })"
				/>
				<UBadge size="xs" variant="soft">
					Projection
				</UBadge>
			</div>
			<p class="font-mono text-xs text-muted" data-testid="social-profile-projection-key">
				{{ projection.key }}
			</p>
			<UFormField label="Talent source" size="xs">
				<USelect
					:model-value="projection.sourceKey"
					:items="sourceOptions"
					value-key="value"
					class="w-full"
					size="sm"
					:disabled="!canAuthor"
					data-testid="social-profile-projection-source"
					@update:model-value="patchProjection(projection.key, { sourceKey: String($event) })"
				/>
			</UFormField>
			<div class="grid grid-cols-2 gap-2">
				<UFormField label="Dwell (seconds)" size="xs">
					<UInputNumber
						:model-value="projection.dwellMs / 1000"
						:min="MIN_SOCIAL_PROFILE_DWELL_MS / 1000"
						:max="MAX_SOCIAL_PROFILE_DWELL_MS / 1000"
						:disabled="!canAuthor"
						data-testid="social-profile-projection-dwell"
						@update:model-value="patchProjection(projection.key, { dwellMs: ($event ?? 8) * 1000 })"
					/>
				</UFormField>
				<UFormField label="Transition" size="xs">
					<USelect
						:model-value="projection.transition"
						:items="transitionOptions"
						value-key="value"
						:disabled="!canAuthor"
						data-testid="social-profile-projection-transition"
						@update:model-value="patchProjection(projection.key, { transition: $event as SocialProfileTransition })"
					/>
				</UFormField>
			</div>
			<UFormField v-if="projection.transition !== 'cut'" label="Transition duration (ms)" size="xs">
				<UInputNumber
					:model-value="projection.transitionDurationMs"
					:min="MIN_SOCIAL_PROFILE_TRANSITION_DURATION_MS"
					:max="MAX_SOCIAL_PROFILE_TRANSITION_DURATION_MS"
					:disabled="!canAuthor"
					data-testid="social-profile-projection-transition-duration"
					@update:model-value="patchProjection(projection.key, { transitionDurationMs: $event ?? 250 })"
				/>
			</UFormField>
			<p class="text-xs text-muted" data-testid="social-profile-projection-group">
				Presentation Group: {{ projection.presentationGroupId }}
			</p>
			<p v-if="consumerCount(projection.key) > 0" class="text-xs text-warning" data-testid="social-profile-projection-deletion-feedback">
				{{ consumerCount(projection.key) }} projected icon or text consumer(s) still depend on this projection. Replace them first to keep the group, or delete the projection and Presentation Group together.
			</p>
			<div v-if="canAuthor" class="flex flex-wrap gap-2">
				<UButton
					size="xs"
					variant="soft"
					color="error"
					:disabled="consumerCount(projection.key) > 0"
					data-testid="social-profile-projection-delete-keep-group"
					@click="removeProjection(projection.key, false)"
				>
					Delete projection, keep group
				</UButton>
				<UButton
					size="xs"
					variant="soft"
					color="error"
					data-testid="social-profile-projection-delete-combined"
					@click="removeProjection(projection.key, true)"
				>
					Delete projection and Presentation Group
				</UButton>
			</div>
		</div>
	</section>
</template>
