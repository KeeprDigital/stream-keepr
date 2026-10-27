import type { EffectScope } from 'vue';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';

const { openPlayerMatchHistory } = vi.hoisted(() => ({
	openPlayerMatchHistory: vi.fn(),
}));
const shownPlayerId = ref<number | null>(null);

mockNuxtImport('usePlayerMatchHistoryModal', () => () => ({ openPlayerMatchHistory, shownPlayerId }));

const alice = { id: 7, name: 'Alice' } as never;
const bob = { id: 8, name: 'Bob' } as never;

const scopes: EffectScope[] = [];
function follow(roster: { value: unknown[] }) {
	const scope = effectScope();
	scopes.push(scope);
	scope.run(() => usePlayerMatchHistoryLink(() => roster.value as never));
}

describe('usePlayerMatchHistoryLink', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		shownPlayerId.value = null;
		await useRouter().replace({ query: {} });
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	it.each([
		[
			'the linked Player\'s history once the roster holds them',
			'7',
			[alice],
		],
		['nothing for a Player the roster lacks', '9', []],
		['nothing for a link that names no Player id', 'alice', []],
	])('opens %s', async (_, linked, opened) => {
		await useRouter().replace({
			query: { player: linked },
		});
		const roster = ref<unknown[]>([]);
		follow(roster);
		expect(openPlayerMatchHistory).not.toHaveBeenCalled();

		roster.value = [alice, bob];
		await flushPromises();

		expect(openPlayerMatchHistory.mock.calls.map(([player]) => player)).toEqual(opened);
	});

	it('keeps the link on the Player the modal shows, and drops it when the modal closes', async () => {
		await useRouter().replace({
			query: { tab: 'lists' },
		});
		follow(ref([alice, bob]));

		shownPlayerId.value = 8;
		await vi.waitFor(() => expect(useRoute().query).toEqual({ tab: 'lists', player: '8' }));
		shownPlayerId.value = null;
		await vi.waitFor(() => expect(useRoute().query).toEqual({ tab: 'lists' }));
	});
});
