<script setup lang="ts">
import type { SupportedSocialNetwork } from '~~/shared/socialProfiles';
import type { TalentScreenLayout, TalentScreenSelection } from '~~/shared/types/enums';
import type { Screen } from '~/types';
import { TALENT_SCREEN_MAX_LINEUP } from '~~/shared/screenModeConfigs/talent';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { SUPPORTED_SOCIAL_NETWORKS } from '~~/shared/socialProfiles';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const eventStore = useEventStore();
const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'talent',
);

defineExpose({ resetConfig, saving });

// Each control's label, read from the mode's config contract (#498).
const fields = screenModeConfigContract('talent').fields;

const selectionOptions: { label: string; value: TalentScreenSelection }[] = [
	{ label: 'One Talent', value: 'one' },
	{ label: 'A lineup', value: 'lineup' },
];

const layoutOptions: { label: string; value: TalentScreenLayout }[] = [
	{ label: 'Lower third', value: 'lowerThird' },
	{ label: 'Full panel', value: 'fullPanel' },
];

const talents = computed(() => eventStore.event?.talents ?? []);

const talentOptions = computed(() => [
	{ label: 'Select a Talent…', value: null },
	...talents.value.map(talent => ({ label: talent.name, value: talent.id })),
]);

/** The lineup in its order, each named; one the Event no longer lists still shows, so it can be removed. */
const lineup = computed(() => config.value.talentIds.map(id => ({
	id,
	name: talents.value.find(talent => talent.id === id)?.name ?? 'Unknown Talent',
})));

const lineupAddOptions = computed(() => talents.value
	.filter(talent => !config.value.talentIds.includes(talent.id))
	.map(talent => ({ label: talent.name, value: talent.id })));

const lineupFull = computed(() => config.value.talentIds.length >= TALENT_SCREEN_MAX_LINEUP);

function addToLineup(talentId: number | null | undefined) {
	if (talentId == null || lineupFull.value)
		return;
	updateConfig({
		talentIds: [...config.value.talentIds, talentId],
	});
}

function moveInLineup(index: number, offset: -1 | 1) {
	const talentIds = [...config.value.talentIds];
	const target = index + offset;
	if (target < 0 || target >= talentIds.length)
		return;
	[talentIds[index], talentIds[target]] = [talentIds[target]!, talentIds[index]!];
	updateConfig({ talentIds });
}

function removeFromLineup(index: number) {
	updateConfig({
		talentIds: config.value.talentIds.filter((_, at) => at !== index),
	});
}

/** The networks shown, always written in the Supported Social Network catalogue's order. */
function toggleNetwork(network: SupportedSocialNetwork, shown: boolean) {
	const chosen = new Set(config.value.socialNetworks);
	if (shown)
		chosen.add(network);
	else
		chosen.delete(network);
	updateConfig({
		socialNetworks: SUPPORTED_SOCIAL_NETWORKS.map(entry => entry.key).filter(key => chosen.has(key)),
	});
}

const dwellSeconds = computed(() => Math.round(config.value.socialProfileDwellMs / fields.socialProfileDwellMs.displayScale));
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard title="Talent">
			<UFormField
				:label="fields.selection.label"
				description="One Talent at a time, or a lineup shown together."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					data-testid="talent-selection"
					:model-value="config.selection"
					:items="selectionOptions"
					class="w-64"
					@update:model-value="updateConfig({ selection: $event })"
				/>
			</UFormField>

			<UFormField
				v-if="config.selection === 'one'"
				label="Talent"
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					data-testid="talent-one"
					:model-value="config.talentId ?? null"
					:items="talentOptions"
					class="w-64"
					@update:model-value="updateConfig({ talentId: $event ?? null })"
				/>
			</UFormField>

			<template v-else>
				<ol v-if="lineup.length > 0" class="flex flex-col gap-2">
					<li
						v-for="(entry, index) in lineup"
						:key="entry.id"
						class="flex items-center justify-between gap-2"
					>
						<span class="text-sm truncate" data-lineup-talent>{{ entry.name }}</span>
						<span class="flex gap-1 shrink-0">
							<UButton
								icon="i-lucide-arrow-up"
								color="neutral"
								variant="ghost"
								size="sm"
								:aria-label="`Move ${entry.name} up`"
								:disabled="index === 0"
								@click="moveInLineup(index, -1)"
							/>
							<UButton
								icon="i-lucide-arrow-down"
								color="neutral"
								variant="ghost"
								size="sm"
								:aria-label="`Move ${entry.name} down`"
								:disabled="index === lineup.length - 1"
								@click="moveInLineup(index, 1)"
							/>
							<UButton
								icon="i-lucide-x"
								color="neutral"
								variant="ghost"
								size="sm"
								:aria-label="`Remove ${entry.name}`"
								@click="removeFromLineup(index)"
							/>
						</span>
					</li>
				</ol>
				<p v-else class="text-sm text-muted">
					No Talent in the lineup yet.
				</p>

				<UFormField
					label="Add to lineup"
					:description="lineupFull ? `A lineup holds at most ${TALENT_SCREEN_MAX_LINEUP} Talents.` : 'Shown in the order listed.'"
					class="flex max-sm:flex-col justify-between items-start gap-4"
				>
					<USelect
						data-testid="talent-lineup-add"
						:model-value="undefined"
						:items="lineupAddOptions"
						:disabled="lineupFull || lineupAddOptions.length === 0"
						placeholder="Select a Talent…"
						class="w-64"
						@update:model-value="addToLineup($event)"
					/>
				</UFormField>
			</template>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Layout">
			<UFormField
				:label="fields.layout.label"
				description="A bar across the bottom, or a panel filling the Screen."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					data-testid="talent-layout"
					:model-value="config.layout"
					:items="layoutOptions"
					class="w-64"
					@update:model-value="updateConfig({ layout: $event })"
				/>
			</UFormField>
			<ScreenSettingsToggle
				:label="fields.showPhoto.label"
				description="Show each Talent's photo, or their initials without one."
				:model-value="config.showPhoto"
				@update:model-value="updateConfig({ showPhoto: $event })"
			/>
			<ScreenSettingsToggle
				:label="fields.showRole.label"
				description="Show each Talent's role, such as Host, below their name."
				:model-value="config.showRole"
				@update:model-value="updateConfig({ showRole: $event })"
			/>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Social Profiles">
			<UFormField label="Networks" description="The Social Profiles shown, in this order.">
				<div class="flex flex-wrap gap-x-4 gap-y-2">
					<UCheckbox
						v-for="network in SUPPORTED_SOCIAL_NETWORKS"
						:key="network.key"
						:label="network.label"
						:model-value="config.socialNetworks.includes(network.key)"
						@update:model-value="toggleNetwork(network.key, $event === true)"
					/>
				</div>
			</UFormField>
			<ScreenSettingsToggle
				:label="fields.rotateSocialProfiles.label"
				description="Show one Social Profile at a time, in turn, on every output alike."
				:model-value="config.rotateSocialProfiles"
				@update:model-value="updateConfig({ rotateSocialProfiles: $event })"
			/>
			<UFormField
				v-if="config.rotateSocialProfiles"
				:label="fields.socialProfileDwellMs.label"
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="dwellSeconds"
					:min="fields.socialProfileDwellMs.min"
					:max="fields.socialProfileDwellMs.max"
					class="w-32"
					@update:model-value="updateConfig({ socialProfileDwellMs: Number($event) * fields.socialProfileDwellMs.displayScale })"
				/>
			</UFormField>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Header">
			<ScreenSettingsToggle
				:label="fields.showHeader.label"
				description="Show a title above the Talent."
				:model-value="config.showHeader"
				@update:model-value="updateConfig({ showHeader: $event })"
			/>

			<UFormField
				v-if="config.showHeader"
				:label="fields.headerText.label"
				description="Leave empty for &quot;On the Desk&quot;."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInput
					:model-value="config.headerText ?? ''"
					placeholder="Auto"
					class="w-64"
					@update:model-value="updateConfig({ headerText: $event || null })"
				/>
			</UFormField>
		</ScreenSettingsCard>
	</div>
</template>
