<script setup lang="ts">
import type { OpLeader, OpPlayerGameData } from '~~/shared/types/game';
import type { SavedOpPlayerDeckList } from '~~/shared/types/opDeckList';
import type { Player } from '~/types';
import { catalogueOpLeader } from '~~/shared/utils/card/op';
import { playerDisplayName } from '~~/shared/utils/playerName';

/**
 * A One Piece Card Game Player's Deck List, edited by hand (ADR-0074): a paste
 * box prefilled with the saved list and a Leader picker. A pasted Leader line
 * overrules the Leader picked. Saving goes through the OP Deck List write,
 * which warns of rule breaches and never refuses; the saved list's warnings
 * stay shown. A hand-edited list of a Player a TCG+ Import brought can be
 * dropped for the import's.
 */
const props = defineProps<{
	player: Player;
}>();

const emit = defineEmits<{
	(e: 'close'): void;
}>();

const eventStore = useEventStore();
const repository = useOpPlayerDeckListRepository();
const { runRequest } = useRequestFeedback();

const text = ref('');
const saved = ref<SavedOpPlayerDeckList | null>(null);
/** The Leader the save sends: the one picked, or the saved list's, catalogued or not. */
const leaderNumber = ref<string | null>(null);
const pickedLeader = ref<OpLeader | null>(null);
const loading = ref(true);
const saving = ref(false);
const takingImported = ref(false);

/** A TCG+ Import keeps a hand edit it differs from; the operator may take the import's instead. */
const canUseImported = computed(() => props.player.externalSource === 'tcgplus' && saved.value?.handEdited === true);

const leaderModel = computed<OpPlayerGameData>({
	get: () => ({ type: 'op' as const, leader: pickedLeader.value }),
	set: (value: OpPlayerGameData) => {
		pickedLeader.value = value.leader ?? null;
		leaderNumber.value = value.leader?.number ?? null;
	},
});

function show(deckList: SavedOpPlayerDeckList | null) {
	saved.value = deckList;
	leaderNumber.value = deckList?.leaderNumber ?? null;
	const leader = deckList?.entries.find(entry => entry.number === deckList.leaderNumber);
	pickedLeader.value = leader?.card
		? catalogueOpLeader(leader.number, leader.card)
		: null;
}

onMounted(async () => {
	const eventId = eventStore.eventId;
	if (!eventId)
		return;
	const answer = await runRequest(
		() => repository.read(eventId, props.player.id),
		{
			loadingRef: loading,
			error: { title: 'Failed to load the Deck List', color: 'error' },
		},
	);
	if (!answer)
		return;
	show(answer.deckList);
	if (!text.value)
		text.value = answer.deckList?.sourceText ?? '';
});

async function save() {
	const eventId = eventStore.eventId;
	if (!eventId)
		return;
	await runRequest(
		() => repository.write(eventId, props.player.id, text.value, leaderNumber.value),
		{
			loadingRef: saving,
			success: { title: 'Deck List saved', color: 'success' },
			error: { title: 'Failed to save the Deck List', color: 'error' },
			onSuccess: answer => show(answer.deckList),
		},
	);
}

async function takeImported() {
	const eventId = eventStore.eventId;
	if (!eventId)
		return;
	await runRequest(
		() => repository.takeImported(eventId, props.player.id),
		{
			loadingRef: takingImported,
			success: { title: 'Imported Deck List restored', color: 'success' },
			error: { title: 'Failed to restore the imported Deck List', color: 'error' },
			onSuccess: (answer) => {
				show(answer.deckList);
				text.value = answer.deckList.sourceText;
			},
		},
	);
}
</script>

<template>
	<UModal
		open
		:title="`Deck List: ${playerDisplayName(player)}`"
		description="One card per line: N[x] CARDNUMBER [name]. A Leader line sets the Leader."
		@update:open="(open: boolean) => { if (!open) emit('close') }"
	>
		<template #body>
			<div class="flex flex-col gap-3">
				<FeatureMatchSetupOpPlayerFields v-model="leaderModel" />
				<UTextarea
					v-model="text"
					:rows="12"
					class="w-full font-mono"
					placeholder="1x OP01-001 Roronoa Zoro&#10;4x OP01-025 Roronoa Zoro"
					aria-label="Deck List text"
					:disabled="loading"
				/>

				<template v-if="saved">
					<p class="text-sm text-muted" data-deck-list :data-hand-edited="saved.handEdited">
						{{ saved.mainboardCount }} Mainboard cards{{ saved.handEdited ? ', edited by hand' : '' }}
					</p>
					<ul class="flex flex-col gap-1" aria-label="Deck List warnings">
						<li v-for="(warning, index) in saved.warnings" :key="`${warning.code}-${index}`">
							<UAlert
								color="warning"
								variant="subtle"
								icon="i-lucide-triangle-alert"
								:title="warning.message"
								:data-warning-code="warning.code"
							/>
						</li>
					</ul>
					<ul class="flex max-h-72 flex-col gap-1 overflow-y-auto" aria-label="Deck List cards">
						<li
							v-for="entry in saved.entries"
							:key="entry.number"
							class="flex items-center gap-2 text-sm"
							data-deck-list-entry
							:data-number="entry.number"
							:data-resolved="entry.card !== null"
						>
							<span class="w-6 text-right tabular-nums">{{ entry.quantity }}</span>
							<span class="w-20 text-muted">{{ entry.number }}</span>
							<span class="min-w-0 flex-1 truncate">
								{{ entry.card?.name ?? 'Unknown card' }}
								<span v-if="entry.number === saved.leaderNumber" class="text-muted">(Leader)</span>
							</span>
							<OpColorDisplay v-if="entry.card" :colors="entry.card.colors" size="sm" />
						</li>
					</ul>
				</template>
			</div>
		</template>
		<template #footer>
			<div class="flex w-full justify-end gap-2">
				<UButton
					v-if="canUseImported"
					label="Use imported Deck List"
					color="neutral"
					variant="outline"
					class="mr-auto"
					:loading="takingImported"
					:disabled="loading || saving"
					@click="takeImported"
				/>
				<UButton
					label="Close"
					color="neutral"
					variant="ghost"
					@click="emit('close')"
				/>
				<UButton
					label="Save"
					color="primary"
					aria-label="Save Deck List"
					:loading="saving"
					:disabled="loading || takingImported"
					@click="save"
				/>
			</div>
		</template>
	</UModal>
</template>
