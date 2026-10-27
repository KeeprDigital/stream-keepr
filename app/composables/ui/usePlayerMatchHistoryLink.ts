import type { Player } from '~/types';

/**
 * `?player=<id>` names the Player whose match history is open: arriving with it
 * opens their history once the roster holds them, and the query follows the
 * modal while it shows another Player or closes.
 */
export function usePlayerMatchHistoryLink(players: () => Player[]) {
	const route = useRoute();
	const router = useRouter();
	const { openPlayerMatchHistory, shownPlayerId } = usePlayerMatchHistoryModal();

	const raw = Array.isArray(route.query.player)
		? route.query.player[0]
		: route.query.player;
	let linkedId: number | null = raw && /^\d+$/.test(raw)
		? Number(raw)
		: null;

	watch(players, (roster) => {
		if (linkedId === null)
			return;
		if (roster.length === 0)
			return;
		// The roster loads whole: a Player it lacks is not coming.
		const player = roster.find(p => p.id === linkedId);
		linkedId = null;
		if (player)
			openPlayerMatchHistory(player);
	}, { immediate: true });

	watch(shownPlayerId, (id) => {
		// The link waits for the roster; until then the query is what it asks for.
		if (linkedId !== null)
			return;
		const player = id === null
			? undefined
			: String(id);
		if (route.query.player === player)
			return;
		void router.replace({
			query: { ...route.query, player },
		});
	});
}
