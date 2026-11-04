import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue';
import type { Game } from '~~/shared/types/enums';
import { computed, ref, toValue } from 'vue';
import { getCardTypeDisplayLabel, getMetagameCardTypeBucket, getMetagameCardTypeBuckets } from '~~/shared/utils/metagame';

interface CardFilterEntry {
	name: string;
	cardType: string | null;
}

interface UseMetagameCardFiltersOptions {
	defaultExcludedTypes?: string[];
	/** The Event's Card Game, whose card types the filters toggle (ADR-0074). */
	game?: MaybeRefOrGetter<Game | undefined>;
}

export function useMetagameCardFilters<T extends CardFilterEntry>(
	entries: Ref<T[]> | ComputedRef<T[]>,
	options: UseMetagameCardFiltersOptions = {},
) {
	const defaultExcludedTypes = options.defaultExcludedTypes ?? [];
	const search = ref('');
	const excludedTypes = ref<Set<string>>(new Set(defaultExcludedTypes));
	const bucketOf = (cardType: string | null) => getMetagameCardTypeBucket(toValue(options.game), cardType);

	const uniqueCardTypes = computed(() => {
		const types = new Set<string>();
		for (const entry of entries.value) {
			if (entry.cardType) {
				types.add(bucketOf(entry.cardType));
			}
		}

		return getMetagameCardTypeBuckets(toValue(options.game)).filter(type => types.has(type));
	});

	const visibleExcludedTypes = computed(() => uniqueCardTypes.value.filter(type => excludedTypes.value.has(type)));
	const hasExclusions = computed(() => visibleExcludedTypes.value.length > 0);
	const hasFilterOverrides = computed(() => {
		if (search.value.trim().length > 0) {
			return true;
		}

		if (excludedTypes.value.size !== defaultExcludedTypes.length) {
			return true;
		}

		return defaultExcludedTypes.some(type => !excludedTypes.value.has(type));
	});

	function getTypeLabel(type: string) {
		return getCardTypeDisplayLabel(type, { nonbasicLandLabel: true });
	}

	function toggleType(type: string) {
		const next = new Set(excludedTypes.value);
		if (next.has(type)) {
			next.delete(type);
		}
		else {
			next.add(type);
		}
		excludedTypes.value = next;
	}

	function resetFilters() {
		search.value = '';
		excludedTypes.value = new Set(defaultExcludedTypes);
	}

	const filteredEntries = computed(() => {
		let currentEntries = entries.value;
		if (search.value) {
			const query = search.value.toLowerCase();
			currentEntries = currentEntries.filter(entry => entry.name.toLowerCase().includes(query));
		}
		if (excludedTypes.value.size > 0) {
			currentEntries = currentEntries.filter(entry => !excludedTypes.value.has(bucketOf(entry.cardType)));
		}
		return currentEntries;
	});

	return {
		search,
		excludedTypes,
		uniqueCardTypes,
		visibleExcludedTypes,
		hasExclusions,
		hasFilterOverrides,
		getTypeLabel,
		toggleType,
		resetFilters,
		filteredEntries,
	};
}
