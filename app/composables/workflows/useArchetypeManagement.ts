import type { MaybeRefOrGetter } from 'vue';
import { screensNamingEventReference } from '~~/shared/utils/screenEventReferences';
import { LazyUIConfirmActionModal } from '#components';
import { countOf, useArchetypeHoldings } from '~/composables/data/useArchetypeHoldings';

/**
 * Merging and deleting an Archetype from its Metagame page. Each asks first,
 * saying what happens to the decks assigned to it and the Screens naming it,
 * and leaves the page once it is gone.
 */
export function useArchetypeManagement(eventId: MaybeRefOrGetter<number>, archetypeId: MaybeRefOrGetter<number>) {
	const archetypeStore = useArchetypeStore();
	const screenStore = useScreenStore();
	const { deckCountOf } = useArchetypeHoldings(eventId);
	const confirmModal = useOverlay().create(LazyUIConfirmActionModal);

	const archetype = computed(() => archetypeStore.archetypes.find(item => item.id === toValue(archetypeId)));
	const screenCount = computed(() => screensNamingEventReference(screenStore.screens, 'archetype', toValue(archetypeId)).length);

	/** Merges this Archetype into another of the Event, answering whether it merged. */
	async function mergeInto(intoArchetypeId: number) {
		const merged = archetype.value;
		const survivor = archetypeStore.archetypes.find(item => item.id === intoArchetypeId);
		if (!merged || !survivor)
			return false;

		const decks = deckCountOf(merged.id);
		const confirmed = await confirmModal.open({
			title: 'Merge archetypes',
			message: `Merge “${merged.name}” into “${survivor.name}”?`,
			description: [
				decks > 0
					? `${countOf(decks, 'deck')} ${decks === 1
						? 'moves'
						: 'move'} to “${survivor.name}”, which keeps its own colours, key cards and pinned series.`
					: `“${survivor.name}” keeps its own colours, key cards and pinned series.`,
				`“${merged.name}” is removed with its own.`,
				screenCount.value > 0
					? `${countOf(screenCount.value, 'Screen')} showing “${merged.name}” will show “${survivor.name}”.`
					: '',
			].filter(Boolean).join(' '),
			confirmLabel: 'Merge',
			icon: 'i-lucide-merge',
			iconColor: 'text-primary',
		}).result;
		if (!confirmed || !await archetypeStore.mergeArchetype(toValue(eventId), merged.id, survivor.id))
			return false;

		await navigateTo(`/event/${toValue(eventId)}/metagame/archetype/${survivor.id}`);
		return true;
	}

	/** Deletes this Archetype, answering whether it was deleted. */
	async function remove() {
		const deleted = archetype.value;
		if (!deleted)
			return false;

		const decks = deckCountOf(deleted.id);
		const confirmed = await confirmModal.open({
			title: 'Delete archetype',
			message: `Delete “${deleted.name}”?`,
			description: [
				decks > 0
					? `${countOf(decks, 'deck')} ${decks === 1
						? 'returns'
						: 'return'} to unreviewed.`
					: '',
				screenCount.value > 0
					? `${countOf(screenCount.value, 'Screen')} showing it will show no Archetype.`
					: '',
			].filter(Boolean).join(' ') || 'This cannot be undone.',
			confirmLabel: 'Delete',
			confirmColor: 'error',
			icon: 'i-lucide-trash-2',
			iconColor: 'text-error',
		}).result;
		if (!confirmed || !await archetypeStore.removeArchetype(toValue(eventId), deleted.id))
			return false;

		await navigateTo(`/event/${toValue(eventId)}/metagame`);
		return true;
	}

	return {
		archetype,
		deckCountOf,
		mergeInto,
		remove,
	};
}
