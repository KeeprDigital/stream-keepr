<script setup lang="ts">
import type { Player } from '~/types';
import { VueDraggable } from 'vue-draggable-plus';

const props = defineProps<{
	listId: number;
	allPlayers: Player[];
	initialMemberIds: number[];
}>();

const eventStore = useEventStore();
const playerListStore = usePlayerListStore();

const saving = ref(false);

// ── Local state tracking pending changes ──

const playerMap = computed(() => {
	const map = new Map<number, Player>();
	for (const p of props.allPlayers) {
		map.set(p.id, p);
	}
	return map;
});

const members = ref<Player[]>(
	props.initialMemberIds
		.map(id => playerMap.value.get(id))
		.filter((p): p is Player => p !== undefined),
);
const originalMemberIds = new Set(props.initialMemberIds);

const memberIds = computed(() => members.value.map(p => p.id));
const memberSet = computed(() => new Set(memberIds.value));

// Search state
const availableSearch = ref('');
const memberSearch = ref('');

// Selection state
const selectedAvailable = ref<Set<number>>(new Set());
const selectedMembers = ref<Set<number>>(new Set());

// ── Sort options ──
type SortOption = 'manual' | 'name-asc' | 'name-desc' | 'position-asc';
const sortMode = ref<SortOption>('manual');

const sortOptions = [
	{ label: 'Manual', value: 'manual' as const },
	{ label: 'Name A-Z', value: 'name-asc' as const },
	{ label: 'Name Z-A', value: 'name-desc' as const },
	{ label: 'Position', value: 'position-asc' as const },
];

// ── Computed lists ──

const availablePlayers = computed(() => {
	const mSet = memberSet.value;
	let available = props.allPlayers.filter(p => !mSet.has(p.id));

	if (availableSearch.value) {
		const q = availableSearch.value.toLowerCase();
		available = available.filter(p => p.name.toLowerCase().includes(q));
	}

	return available;
});

const memberSearchLower = computed(() => memberSearch.value.toLowerCase());

function isMemberVisible(player: Player): boolean {
	if (!memberSearch.value)
		return true;
	return player.name.toLowerCase().includes(memberSearchLower.value);
}

const visibleMemberCount = computed(() => {
	if (!memberSearch.value)
		return members.value.length;
	return members.value.filter(p => isMemberVisible(p)).length;
});

// ── Sort actions ──

function applySortMode(mode: SortOption) {
	sortMode.value = mode;
	if (mode === 'manual')
		return;

	const sorted = [...members.value];
	sorted.sort((a, b) => {
		switch (mode) {
			case 'name-asc':
				return a.name.localeCompare(b.name);
			case 'name-desc':
				return b.name.localeCompare(a.name);
			case 'position-asc': {
				const posA = a.position ?? Number.MAX_SAFE_INTEGER;
				const posB = b.position ?? Number.MAX_SAFE_INTEGER;
				return posA - posB;
			}
			default:
				return 0;
		}
	});

	members.value = sorted;
	sortMode.value = 'manual';
}

function handleDragUpdate() {
	sortMode.value = 'manual';
}

// ── Transfer actions ──

function addSelected() {
	const toAdd = [...selectedAvailable.value];
	if (toAdd.length === 0)
		return;

	const newPlayers = toAdd
		.map(id => playerMap.value.get(id))
		.filter((p): p is Player => p !== undefined);

	members.value = [...members.value, ...newPlayers];
	selectedAvailable.value = new Set();
}

function removeSelected() {
	const toRemove = selectedMembers.value;
	if (toRemove.size === 0)
		return;

	members.value = members.value.filter(p => !toRemove.has(p.id));
	selectedMembers.value = new Set();
}

function addPlayer(playerId: number) {
	if (memberSet.value.has(playerId))
		return;
	const player = playerMap.value.get(playerId);
	if (player) {
		members.value = [...members.value, player];
	}
}

function removePlayer(playerId: number) {
	members.value = members.value.filter(p => p.id !== playerId);
	selectedMembers.value.delete(playerId);
	selectedMembers.value = new Set(selectedMembers.value);
}

// ── Selection helpers ──

function toggleAvailableSelection(playerId: number) {
	const set = new Set(selectedAvailable.value);
	if (set.has(playerId))
		set.delete(playerId);
	else set.add(playerId);
	selectedAvailable.value = set;
}

function toggleMemberSelection(playerId: number) {
	const set = new Set(selectedMembers.value);
	if (set.has(playerId))
		set.delete(playerId);
	else set.add(playerId);
	selectedMembers.value = set;
}

function selectAllAvailable() {
	selectedAvailable.value = new Set(availablePlayers.value.map(p => p.id));
}

function deselectAllAvailable() {
	selectedAvailable.value = new Set();
}

function selectAllMembers() {
	const visible = members.value.filter(p => isMemberVisible(p));
	selectedMembers.value = new Set(visible.map(p => p.id));
}

function deselectAllMembers() {
	selectedMembers.value = new Set();
}

// ── Change detection ──

const hasChanges = computed(() => {
	const currentSet = memberSet.value;
	if (currentSet.size !== originalMemberIds.size)
		return true;
	for (const id of currentSet) {
		if (!originalMemberIds.has(id))
			return true;
	}
	const ids = memberIds.value;
	for (let i = 0; i < ids.length; i++) {
		if (ids[i] !== props.initialMemberIds[i])
			return true;
	}
	return false;
});

// ── Reset ──

function reset() {
	members.value = props.initialMemberIds
		.map(id => playerMap.value.get(id))
		.filter((p): p is Player => p !== undefined);
	availableSearch.value = '';
	memberSearch.value = '';
	selectedAvailable.value = new Set();
	selectedMembers.value = new Set();
}

// ── Save ──

async function save() {
	if (!eventStore.eventId || !hasChanges.value)
		return;
	saving.value = true;

	try {
		const currentSet = memberSet.value;
		const addedIds = [...currentSet].filter(id => !originalMemberIds.has(id));
		const removedIds = [...originalMemberIds].filter(id => !currentSet.has(id));

		if (addedIds.length > 0) {
			const added = await playerListStore.addMembers(eventStore.eventId, props.listId, addedIds);
			if (!added)
				throw new Error('Failed to add list members');
		}

		if (removedIds.length > 0) {
			const removed = await playerListStore.batchRemoveMembers(eventStore.eventId, props.listId, removedIds);
			if (!removed)
				throw new Error('Failed to remove list members');
		}

		const ids = memberIds.value;
		if (ids.length > 0) {
			const reordered = await playerListStore.reorderMembers(eventStore.eventId, props.listId, ids);
			if (!reordered)
				throw new Error('Failed to reorder list members');
		}

		const loaded = await playerListStore.loadListMembers(eventStore.eventId, props.listId);
		if (!loaded)
			throw new Error('List saved, but its members could not be refreshed');
	}
	finally {
		saving.value = false;
	}
}

defineExpose({ hasChanges, save, reset, saving });
</script>

<template>
	<div>
		<div class="grid min-h-[400px] grid-cols-1 gap-4 lg:grid-cols-2">
			<!-- LEFT: Available Players -->
			<div class="flex flex-col border border-default rounded-lg overflow-hidden">
				<div class="px-3 py-2 bg-elevated border-b border-default">
					<div class="flex items-center justify-between mb-2">
						<span class="text-sm font-medium">Available Players</span>
						<span class="text-xs text-muted">{{ availablePlayers.length }}</span>
					</div>
					<UInput
						v-model="availableSearch"
						icon="i-lucide-search"
						placeholder="Search..."
						size="xs"
						aria-label="Search available players"
					/>
				</div>

				<div class="flex items-center justify-between px-3 py-1 border-b border-default bg-elevated/50 min-h-[33px]">
					<UCheckbox
						:model-value="availablePlayers.length > 0 && selectedAvailable.size === availablePlayers.length"
						:indeterminate="selectedAvailable.size > 0 && selectedAvailable.size < availablePlayers.length"
						size="xs"
						@update:model-value="val => val ? selectAllAvailable() : deselectAllAvailable()"
					/>
					<UButton
						v-if="selectedAvailable.size > 0"
						variant="ghost"
						size="xs"
						icon="i-lucide-chevron-right"
						:label="`Add ${selectedAvailable.size}`"
						@click="addSelected"
					/>
				</div>

				<div class="flex-1 overflow-y-auto">
					<div
						v-for="player in availablePlayers"
						:key="player.id"
						class="flex items-center gap-2 px-3 py-1.5 hover:bg-elevated/50 cursor-pointer border-b border-default last:border-b-0"
						role="option"
						:aria-selected="selectedAvailable.has(player.id)"
						tabindex="0"
						@click="toggleAvailableSelection(player.id)"
						@keydown.enter="toggleAvailableSelection(player.id)"
						@keydown.space.prevent="toggleAvailableSelection(player.id)"
					>
						<UCheckbox
							:model-value="selectedAvailable.has(player.id)"
							size="xs"
							:aria-label="`Select ${player.name}`"
							@click.stop
							@update:model-value="toggleAvailableSelection(player.id)"
						/>
						<span class="text-sm flex-1 truncate">{{ player.name }}</span>
						<UButton
							variant="ghost"
							color="neutral"
							size="xs"
							icon="i-lucide-plus"
							class="shrink-0"
							:aria-label="`Add ${player.name} to list`"
							@click.stop="addPlayer(player.id)"
						/>
					</div>
					<div v-if="availablePlayers.length === 0" class="p-4 text-center text-sm text-muted">
						{{ availableSearch ? 'No matching players' : 'All players are in this list' }}
					</div>
				</div>
			</div>

			<!-- RIGHT: Current Members -->
			<div class="flex flex-col border border-default rounded-lg overflow-hidden">
				<div class="px-3 py-2 bg-elevated border-b border-default">
					<div class="flex items-center justify-between mb-2">
						<span class="text-sm font-medium">List Members</span>
						<span class="text-xs text-muted">{{ members.length }}</span>
					</div>
					<div class="flex gap-2">
						<UInput
							v-model="memberSearch"
							icon="i-lucide-search"
							placeholder="Search..."
							size="xs"
							class="flex-1"
							aria-label="Search list members"
						/>
						<UDropdownMenu
							:items="[sortOptions.map(opt => ({
								label: opt.label,
								onSelect: () => applySortMode(opt.value),
							}))]"
						>
							<UButton
								variant="ghost"
								color="neutral"
								size="xs"
								icon="i-lucide-arrow-up-down"
								label="Sort"
							/>
						</UDropdownMenu>
					</div>
				</div>

				<div class="flex items-center justify-between px-3 py-1 border-b border-default bg-elevated/50 min-h-[33px]">
					<UCheckbox
						:model-value="visibleMemberCount > 0 && selectedMembers.size === visibleMemberCount"
						:indeterminate="selectedMembers.size > 0 && selectedMembers.size < visibleMemberCount"
						size="xs"
						@update:model-value="val => val ? selectAllMembers() : deselectAllMembers()"
					/>
					<UButton
						v-if="selectedMembers.size > 0"
						variant="ghost"
						color="error"
						size="xs"
						icon="i-lucide-chevron-left"
						:label="`Remove ${selectedMembers.size}`"
						@click="removeSelected"
					/>
				</div>

				<VueDraggable
					v-model="members"
					:disabled="!!memberSearch"
					:animation="150"
					handle=".drag-handle"
					ghost-class="opacity-30"
					class="flex-1 overflow-y-auto"
					@update="handleDragUpdate"
				>
					<div
						v-for="player in members"
						v-show="isMemberVisible(player)"
						:key="player.id"
						class="flex items-center gap-2 px-3 py-1.5 hover:bg-elevated/50 border-b border-default last:border-b-0"
					>
						<UIcon
							name="i-lucide-grip-vertical"
							class="drag-handle cursor-grab active:cursor-grabbing text-muted shrink-0"
							:class="{ 'opacity-30 pointer-events-none': !!memberSearch }"
						/>
						<UCheckbox
							:model-value="selectedMembers.has(player.id)"
							size="xs"
							:aria-label="`Select ${player.name}`"
							@update:model-value="toggleMemberSelection(player.id)"
						/>
						<button type="button" class="flex-1 truncate text-left text-sm" @click="toggleMemberSelection(player.id)">
							{{ player.name }}
						</button>
						<span v-if="player.position" class="text-xs text-muted font-mono">#{{ player.position }}</span>
						<UButton
							variant="ghost"
							color="error"
							size="xs"
							icon="i-lucide-x"
							class="shrink-0"
							:aria-label="`Remove ${player.name} from list`"
							@click="removePlayer(player.id)"
						/>
					</div>
				</VueDraggable>
				<div v-if="members.length === 0" class="p-4 text-center text-sm text-muted">
					No members in this list yet
				</div>
				<div v-else-if="visibleMemberCount === 0" class="p-4 text-center text-sm text-muted">
					No matching members
				</div>
			</div>
		</div>
	</div>
</template>
