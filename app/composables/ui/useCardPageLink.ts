import type { Ref } from 'vue';
import type { CardPageMode } from '~/types/card/page';

interface CardPageView {
	mode: Ref<CardPageMode>;
	roundId: Ref<number | null>;
	matchId: Ref<number | null>;
	playerId: Ref<number | null>;
}

const LINK_KEYS = [
	'mode',
	'roundId',
	'matchId',
	'playerId',
] as const;

function queryId(value: unknown): number | null {
	const raw = Array.isArray(value)
		? value[0]
		: value;
	return typeof raw === 'string' && /^\d+$/.test(raw)
		? Number(raw)
		: null;
}

/**
 * The Cards page's query names the deck it shows: `?mode=match-decklist&roundId=&matchId=`
 * or `?mode=player-decklist&playerId=`. Arriving with one restores that view over what
 * the store holds; the query then follows the view. `linked` says arrival named a view.
 */
export function useCardPageLink(view: CardPageView) {
	const route = useRoute();
	const router = useRouter();

	const linkedMode = route.query.mode;
	const linked = linkedMode === 'match-decklist' || linkedMode === 'player-decklist';
	if (linkedMode === 'match-decklist') {
		view.mode.value = linkedMode;
		view.roundId.value = queryId(route.query.roundId);
		view.matchId.value = queryId(route.query.matchId);
	}
	else if (linkedMode === 'player-decklist') {
		view.mode.value = linkedMode;
		view.playerId.value = queryId(route.query.playerId);
	}

	const linkQuery = computed<Record<string, string | undefined>>(() => {
		const id = (value: number | null) => value === null
			? undefined
			: String(value);
		switch (view.mode.value) {
			case 'match-decklist':
				return {
					mode: view.mode.value,
					roundId: id(view.roundId.value),
					matchId: id(view.matchId.value),
				};
			case 'player-decklist':
				return {
					mode: view.mode.value,
					playerId: id(view.playerId.value),
				};
			default:
				return {};
		}
	});

	watch(linkQuery, (link) => {
		const unchanged = LINK_KEYS.every(key => route.query[key] === link[key]);
		if (unchanged)
			return;
		const query = { ...route.query };
		for (const key of LINK_KEYS)
			delete query[key];
		void router.replace({
			query: {
				...query,
				...link,
			},
		});
	}, { immediate: true });

	return { linked };
}
