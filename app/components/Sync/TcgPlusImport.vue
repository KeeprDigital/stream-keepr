<script setup lang="ts">
import type { TcgPlusImportedPlayer, TcgPlusImportHeldPlayer } from '~~/shared/types/tcgPlusImport';

/**
 * A One Piece Card Game Event's Sync page: the TCG+ Import (ADR-0074). The
 * operator chooses the Bandai TCG+ deck list export, sees what it would
 * change and what it warns of, and confirms. Nothing is saved before the
 * confirm.
 */
const eventStore = useEventStore();
const { status, fileName, preview, answer, error, choose, confirm, dismiss } = useTcgPlusImport(() => eventStore.eventId);

const fileInput = useTemplateRef<HTMLInputElement>('fileInput');

function onFileChosen(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	// Cleared straight away so choosing the same file again still fires a change.
	input.value = '';
	if (file)
		void choose(file);
}

const busy = computed(() => status.value === 'previewing' || status.value === 'importing');

function incomingLabel(player: TcgPlusImportedPlayer) {
	return `${player.nickname} (${player.memberNumber})`;
}

function heldLabel(player: TcgPlusImportHeldPlayer) {
	return player.memberNumber
		? `${player.shownAs} (${player.memberNumber})`
		: player.shownAs;
}

const changeGroups = computed(() => preview.value
	? [
			{
				key: 'added',
				title: 'Players to add',
				labels: preview.value.added.map(incomingLabel),
			},
			{
				key: 'deckListChanged',
				title: 'Deck Lists that change',
				labels: preview.value.deckListChanged.map(heldLabel),
			},
			{
				key: 'deactivated',
				title: 'Players to mark inactive',
				labels: preview.value.deactivated.map(heldLabel),
			},
		]
	: []);

const warningGroups = computed(() => {
	const warnings = preview.value?.warnings;
	if (!warnings)
		return [];
	return [
		{
			key: 'ruleBreaches',
			title: 'Deck rule breaches',
			description: 'Imported as they are.',
			lines: warnings.ruleBreaches.map(breach => `${incomingLabel(breach)}: ${breach.warnings.map(warning => warning.message).join(' ')}`),
		},
		{
			key: 'unknownCards',
			title: 'Unknown card numbers',
			description: 'Kept as numbers only, to resolve on the Cards page.',
			lines: warnings.unknownCards.map(card => `${card.number}, in ${card.playerCount} Deck List${card.playerCount === 1
				? ''
				: 's'}`),
		},
		{
			key: 'handEditConflicts',
			title: 'Hand-edited Deck Lists kept',
			description: 'The export differs; use the imported Deck List from the Players page to take it.',
			lines: warnings.handEditConflicts.map(heldLabel),
		},
		{
			key: 'possibleDuplicates',
			title: 'Possible duplicates',
			description: 'A Player added by hand shares a Nickname in the export. Nothing is merged.',
			lines: warnings.possibleDuplicates.map(duplicate => `${heldLabel(duplicate)} and ${duplicate.nickname} (${duplicate.incomingMemberNumber})`),
		},
	].filter(group => group.lines.length > 0);
});
</script>

<template>
	<NuxtLayout name="default">
		<UContainer class="max-w-4xl">
			<div class="flex flex-col gap-4" data-tcgplus-import :data-status="status">
				<UCard>
					<template #header>
						<div class="flex items-center gap-2">
							<UIcon name="i-lucide-file-up" class="text-muted" />
							<span class="text-sm font-semibold">TCG+ Import</span>
						</div>
					</template>
					<div class="flex flex-col gap-3">
						<p class="text-sm text-muted">
							Choose the deck list export from Bandai TCG+. You'll see what it changes before anything is saved.
							A re-import updates Players by member number and keeps names you gave and Deck Lists you edited.
						</p>
						<div class="flex flex-wrap items-center gap-2">
							<input
								ref="fileInput"
								type="file"
								accept=".csv,text/csv"
								class="hidden"
								aria-label="TCG+ export file"
								@change="onFileChosen"
							>
							<UButton
								icon="i-lucide-upload"
								:loading="status === 'previewing'"
								:disabled="busy"
								@click="fileInput?.click()"
							>
								Choose export
							</UButton>
							<span v-if="fileName" class="text-sm text-muted" data-file-name>{{ fileName }}</span>
						</div>
					</div>
				</UCard>

				<UAlert
					v-if="error"
					color="error"
					variant="subtle"
					icon="i-lucide-circle-x"
					:title="preview ? 'The import failed; nothing was saved' : 'The export could not be previewed'"
					:description="error"
					data-tcgplus-error
				/>

				<UAlert
					v-if="answer"
					color="success"
					variant="subtle"
					icon="i-lucide-circle-check"
					:title="answer.message"
					:description="answer.warnings?.join(' ')"
					data-tcgplus-imported
				/>

				<UCard v-if="preview">
					<template #header>
						<span class="text-sm font-semibold" data-preview-player-count>{{ preview.playerCount }} Players in the export</span>
					</template>
					<div class="flex flex-col gap-4">
						<section
							v-for="group in changeGroups"
							:key="group.key"
							:data-preview-group="group.key"
							:data-count="group.labels.length"
						>
							<h3 class="text-sm font-medium">
								{{ group.title }}: {{ group.labels.length }}
							</h3>
							<ul v-if="group.labels.length > 0" class="mt-1 max-h-40 overflow-y-auto text-sm text-muted">
								<li v-for="label in group.labels" :key="label">
									{{ label }}
								</li>
							</ul>
						</section>

						<section data-preview-leaders>
							<h3 class="text-sm font-medium">
								Leaders
							</h3>
							<ul class="mt-1 flex flex-col gap-1 text-sm">
								<li
									v-for="leader in preview.leaders"
									:key="leader.number"
									class="flex items-center gap-2"
									data-preview-leader
									:data-number="leader.number"
									:data-count="leader.playerCount"
								>
									<span class="w-8 text-right tabular-nums">{{ leader.playerCount }}</span>
									<span class="w-20 text-muted">{{ leader.number }}</span>
									<span class="min-w-0 flex-1 truncate">{{ leader.name ?? 'Unknown card' }}</span>
									<OpColorDisplay v-if="leader.colors.length > 0" :colors="leader.colors" size="sm" />
								</li>
							</ul>
						</section>

						<UAlert
							v-for="group in warningGroups"
							:key="group.key"
							color="warning"
							variant="subtle"
							icon="i-lucide-triangle-alert"
							:title="`${group.title}: ${group.lines.length}`"
							:data-preview-warning="group.key"
							:data-count="group.lines.length"
						>
							<template #description>
								<p>{{ group.description }}</p>
								<ul class="mt-1 max-h-40 overflow-y-auto">
									<li v-for="line in group.lines" :key="line">
										{{ line }}
									</li>
								</ul>
							</template>
						</UAlert>
					</div>
					<template #footer>
						<div class="flex justify-end gap-2">
							<UButton
								color="neutral"
								variant="ghost"
								:disabled="busy"
								@click="dismiss"
							>
								Cancel
							</UButton>
							<UButton
								color="primary"
								:loading="status === 'importing'"
								:disabled="busy"
								@click="confirm"
							>
								Import {{ preview.playerCount }} Players
							</UButton>
						</div>
					</template>
				</UCard>
			</div>
		</UContainer>
	</NuxtLayout>
</template>
