import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';

const { modal } = vi.hoisted(() => ({
	modal: {
		open: vi.fn(),
	},
}));

mockNuxtImport('useOverlay', () => () => ({
	create: () => modal,
}));

function player(id: number, name: string) {
	return { id, name } as never;
}

/** Names the Players each opening showed, with the Player its back button returns to. */
function openings() {
	return modal.open.mock.calls.map(([props]) => [props.player.name, props.previousPlayer?.name ?? null]);
}

describe('usePlayerMatchHistoryModal', () => {
	let closed = deferred();

	async function close() {
		closed.resolve();
		await flushPromises();
		closed = deferred();
	}

	beforeEach(async () => {
		await close();
		modal.open.mockReset();
		modal.open.mockImplementation(() => closed.promise);
	});

	it.each([
		[
			'an opponent opened from an open modal leads back to the Player before',
			async (open: (p: never) => void) => {
				open(player(7, 'Alice'));
				open(player(8, 'Bob'));
				open(player(9, 'Cara'));
			},
			[
				['Alice', null],
				['Bob', 'Alice'],
				['Cara', 'Bob'],
			],
		],
		[
			'reopening the Player shown adds no step',
			async (open: (p: never) => void) => {
				open(player(7, 'Alice'));
				open(player(7, 'Alice'));
			},
			[
				['Alice', null],
				['Alice', null],
			],
		],
		[
			'a modal opened after the last one closed starts afresh',
			async (open: (p: never) => void) => {
				open(player(7, 'Alice'));
				await close();
				open(player(8, 'Bob'));
			},
			[
				['Alice', null],
				['Bob', null],
			],
		],
	])('%s', async (_, steps, expected) => {
		await steps(usePlayerMatchHistoryModal().openPlayerMatchHistory as never);

		expect(openings()).toEqual(expected);
	});

	it('goes back one Player at a time, until there is none before', () => {
		const { openPlayerMatchHistory } = usePlayerMatchHistoryModal();
		openPlayerMatchHistory(player(7, 'Alice'));
		openPlayerMatchHistory(player(8, 'Bob'));
		openPlayerMatchHistory(player(9, 'Cara'));
		const goBack = modal.open.mock.lastCall![0].onBack;
		modal.open.mockClear();

		for (let step = 0; step < 3; step++)
			goBack();

		expect(openings()).toEqual([
			['Bob', 'Alice'],
			['Alice', null],
		]);
	});
});
