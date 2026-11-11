<script setup lang="ts">
import type { SupportedSocialNetwork } from '~~/shared/socialProfiles';
import type { TalentScreenLayout, TalentScreenSelection } from '~~/shared/types/enums';
import type { Screen } from '~/types';
import { TALENT_SCREEN_AUTO_HEADER_TEXT, TALENT_SCREEN_MAX_LINEUP } from '~~/shared/screenModeConfigs/talent';
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

/** The networks shown, always written in the Supported Social Network catalog's order. */
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

const layoutSummary = computed(() => [
	layoutOptions.find(option => option.value === config.value.layout)?.label,
	config.value.showPhoto ? 'Photo' : null,
	config.value.showRole ? 'Role' : null,
].filter(Boolean).join(' · '));

const headerSummary = computed(() => config.value.showHeader
	? config.value.headerText || TALENT_SCREEN_AUTO_HEADER_TEXT
	: 'Hidden');

const socialProfilesSummary = computed(() => {
	const count = config.value.socialNetworks.length;
	if (count === 0)
		return 'None shown';
	const networks = `${count} ${count === 1
		? 'network'
		: 'networks'}`;
	return config.value.rotateSocialProfiles
		? `${networks} · one at a time, ${config.value.socialProfileDwellMs / fields.socialProfileDwellMs.displayScale} s each`
		: networks;
});
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsSection id="talent:talent" title="Talent" :collapsible="false">
			<ScreenConfigField
				:field="fields.selection"
				:model-value="config.selection"
				:items="selectionOptions"
				description="One Talent at a time, or a lineup shown together."
				@update:model-value="updateConfig({ selection: $event as TalentScreenSelection })"
			/>

			<ScreenTalentField
				v-if="config.selection === 'one'"
				data-testid="talent-one"
				:model-value="config.talentId"
				description="The Talent shown."
				@update:model-value="updateConfig({ talentId: $event })"
			/>

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

				<ScreenSettingsField
					label="Add to lineup"
					:description="lineupFull ? `A lineup holds at most ${TALENT_SCREEN_MAX_LINEUP} Talents.` : 'Shown in the order listed.'"
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
				</ScreenSettingsField>
			</template>
		</ScreenSettingsSection>

		<ScreenSettingsSection id="talent:layout" title="Layout" :summary="layoutSummary">
			<ScreenConfigField
				:field="fields.layout"
				:model-value="config.layout"
				:items="layoutOptions"
				description="A bar across the bottom, or a panel filling the Screen."
				@update:model-value="updateConfig({ layout: $event as TalentScreenLayout })"
			/>
			<ScreenConfigField
				:field="fields.showPhoto"
				:model-value="config.showPhoto"
				description="Show each Talent's photo, or their initials without one."
				@update:model-value="updateConfig({ showPhoto: $event === true })"
			/>
			<ScreenConfigField
				:field="fields.showRole"
				:model-value="config.showRole"
				description="Show each Talent's role, such as Host, below their name."
				@update:model-value="updateConfig({ showRole: $event === true })"
			/>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="layout" />
		</ScreenSettingsSection>

		<ScreenHeaderSettingsCard
			id="talent:header"
			:summary="headerSummary"
			:config="config"
			:fields="fields"
			show-description="Show a title above the Talent."
			:auto-description="`Leave empty for &quot;${TALENT_SCREEN_AUTO_HEADER_TEXT}&quot;.`"
			@update="updateConfig($event)"
		>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="header" />
		</ScreenHeaderSettingsCard>

		<ScreenSettingsSection id="talent:social-profiles" title="Social Profiles" :summary="socialProfilesSummary">
			<ScreenSettingsField label="Networks" description="The Social Profiles shown, in this order.">
				<div class="flex flex-wrap gap-x-4 gap-y-2">
					<UCheckbox
						v-for="network in SUPPORTED_SOCIAL_NETWORKS"
						:key="network.key"
						:label="network.label"
						:model-value="config.socialNetworks.includes(network.key)"
						@update:model-value="toggleNetwork(network.key, $event === true)"
					/>
				</div>
			</ScreenSettingsField>
			<ScreenConfigField
				:field="fields.rotateSocialProfiles"
				:model-value="config.rotateSocialProfiles"
				description="Show one Social Profile at a time, in turn, on every output alike."
				@update:model-value="updateConfig({ rotateSocialProfiles: $event === true })"
			/>
			<ScreenConfigField
				v-if="config.rotateSocialProfiles"
				:field="fields.socialProfileDwellMs"
				:model-value="config.socialProfileDwellMs"
				description="How long each Social Profile shows before the next."
				@update:model-value="updateConfig({ socialProfileDwellMs: Number($event) })"
			/>
			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="social-profiles" />
		</ScreenSettingsSection>
	</div>
</template>
