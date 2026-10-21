import type { ScreenMode } from '~~/shared/types/enums';
import type { ModeConfigsMap } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { modeConfigPatchSchemaMap } from '~~/server/schemas/api/screen';
import { getDefaultConfigForMode, mergeScreenModeConfig } from '~~/shared/types/screenConfig';
import { STATE_CONFLICT_CODE } from '~~/shared/utils/stateConflict';
import { createMockScreen } from '~~/test/helpers/fixtures';

/**
 * A Screen settings edit from the operator's control to what a reload shows (#703).
 *
 * Real: the configuration composable (`useModeConfigUpdate`, over `useConfigUpdate`),
 * the Screen store that owns the Screen, and the Event reset navigation runs. Faked:
 * only the repository, by a server that takes each request the way the wire does —
 * through JSON — and answers it with the real mode-configuration PATCH schema and
 * the real merge, holding one revision and refusing a write made against an older one.
 * Every answer can be held back, so the order under test is the test's.
 */

const mockToast = { add: vi.fn() };
mockNuxtImport('useToast', () => () => mockToast);

const mockRepo = {
	list: vi.fn(),
	getById: vi.fn(),
	getBySlug: vi.fn(),
	getScreenOutputById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	updateModeConfig: vi.fn(),
	updateScreenConfig: vi.fn(),
	remove: vi.fn(),
};
mockNuxtImport('useScreenRepository', () => () => mockRepo);

function wire<T>(value: T): T {
	return JSON.parse(JSON.stringify(value));
}

/** One Event's Screens as the server holds them. */
function createServer(initial: Screen) {
	let held: Screen = wire(initial);
	/** Each request body as it crossed the wire. */
	const bodies: Record<string, unknown>[] = [];
	const holds: Array<() => void> = [];
	let holding = false;

	mockRepo.list.mockImplementation(async () => [wire(held)]);
	mockRepo.getById.mockImplementation(async () => wire(held));
	mockRepo.updateModeConfig.mockImplementation(async (eventId: number, screenId: number, mode: ScreenMode, config: Record<string, unknown>, stateVersion: number) => {
		const body = wire({ ...config, stateVersion });
		bodies.push(body);
		if (holding)
			await new Promise<void>(resolve => holds.push(resolve));
		if (eventId !== held.eventId || screenId !== held.id)
			throw Object.assign(new Error('Screen not found'), { statusCode: 404 });
		const { stateVersion: sent, ...raw } = body;
		const patch = modeConfigPatchSchemaMap[mode].parse(raw) as Record<string, unknown>;
		if (sent !== held.stateVersion)
			throw Object.assign(new Error('Conflict'), { statusCode: 409, data: { data: { code: STATE_CONFLICT_CODE } } });
		held = {
			...held,
			modeConfigs: mergeScreenModeConfig((held.modeConfigs ?? {}) as ModeConfigsMap, mode, patch),
			stateVersion: held.stateVersion + 1,
		};
		return wire(held);
	});

	return {
		bodies,
		get held() {
			return held;
		},
		/** Hold every answer from now on until `release`. */
		hold() {
			holding = true;
		},
		release() {
			holding = false;
			for (const resolve of holds.splice(0))
				resolve();
		},
	};
}

/** Through both debounces — the composable's and the store's — so the edit is on the wire. */
async function sendPending() {
	await vi.advanceTimersByTimeAsync(2_000);
}

function fieldOf(config: unknown, field: string): unknown {
	return (config as Record<string, unknown>)[field];
}

/** The settings surface as the reload after the save shows it. */
async function reloadedConfig<M extends ScreenMode>(mode: M) {
	const store = useScreenStore();
	store.$reset();
	await store.loadScreensByEventId(1);
	const scope = effectScope();
	const { config } = scope.run(() => useModeConfigUpdate(1, 1, mode))!;
	const shown = { ...config.value };
	scope.stop();
	return shown;
}

describe('screen settings saves', () => {
	beforeEach(async () => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		const store = useScreenStore();
		store.$reset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function openScreen(screen: Screen) {
		const server = createServer(screen);
		await useScreenStore().loadScreensByEventId(1);
		return server;
	}

	describe('an edit queued behind a save in flight', () => {
		const initial = createMockScreen({ id: 1, eventId: 1, stateVersion: 3, modeConfigs: { metagame: { topN: 8, limit: 50 } } });

		it('reaches its own Event and Screen when the operator navigates to another Event', async () => {
			const server = await openScreen(initial);
			const scope = effectScope();
			const { updateConfig } = scope.run(() => useModeConfigUpdate(1, 1, 'metagame'))!;

			server.hold();
			updateConfig({ topN: 16 });
			await sendPending();
			expect(server.bodies).toHaveLength(1);
			updateConfig({ limit: 20 });
			await sendPending();

			resetAllEventStores();
			scope.stop();
			server.release();
			await sendPending();

			expect(server.bodies).toEqual([{ topN: 16, stateVersion: 3 }, { limit: 20, stateVersion: 4 }]);
			expect(server.held.modeConfigs).toEqual({ metagame: { topN: 16, limit: 20 } });
			expect(await reloadedConfig('metagame')).toMatchObject({ topN: 16, limit: 20 });
		});

		it('reaches the server when the settings surface closes before its debounce fires', async () => {
			const server = await openScreen(initial);
			const scope = effectScope();
			const { updateConfig } = scope.run(() => useModeConfigUpdate(1, 1, 'metagame'))!;

			server.hold();
			updateConfig({ topN: 16 });
			await sendPending();
			updateConfig({ limit: 20 });
			scope.stop();
			server.release();
			await sendPending();

			expect(server.held.modeConfigs).toEqual({ metagame: { topN: 16, limit: 20 } });
			expect(await reloadedConfig('metagame')).toMatchObject({ topN: 16, limit: 20 });
		});

		it('reaches the server when the operator navigates before any debounce fires', async () => {
			const server = await openScreen(initial);
			const scope = effectScope();
			const { updateConfig } = scope.run(() => useModeConfigUpdate(1, 1, 'metagame'))!;

			updateConfig({ topN: 16 });
			updateConfig({ limit: 20 });
			resetAllEventStores();
			scope.stop();
			await sendPending();

			expect(server.held.modeConfigs).toEqual({ metagame: { topN: 16, limit: 20 } });
		});

		it('reports a queued edit the server refuses as failed, never as saved', async () => {
			const server = await openScreen(initial);
			const scope = effectScope();
			const { updateConfig, saveState } = scope.run(() => useModeConfigUpdate(1, 1, 'metagame'))!;

			server.hold();
			updateConfig({ topN: 16 });
			await sendPending();
			// Out of the contract's bounds, so the PATCH schema refuses it.
			updateConfig({ limit: 9_999 });
			await sendPending();
			resetAllEventStores();
			server.release();
			await sendPending();

			expect(server.bodies).toEqual([{ topN: 16, stateVersion: 3 }, { limit: 9_999, stateVersion: 4 }]);
			expect(server.held.modeConfigs).toEqual({ metagame: { topN: 16, limit: 50 } });
			expect(saveState.value).toBe('failed');
			expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
			scope.stop();
		});
	});

	/**
	 * Clearing an optional field: nonempty to empty, through the request, the merge,
	 * the answer and a reload. Each row is a field one of these modes' settings let an
	 * operator clear, with an unrelated field beside it that must survive.
	 */
	describe.each<[ScreenMode, string, unknown, Record<string, unknown>]>([
		['metagame', 'archetypeFilter', 'Rakdos Midrange', { topN: 16 }],
		['metagame', 'headerText', 'Day 2 Metagame', { topN: 16 }],
		['metagame', 'playerListId', 7, { topN: 16 }],
		['top-cards', 'archetypeFilter', 'Azorius Control', { topN: 4 }],
		['top-cards', 'headerText', 'Top Cards', { topN: 4 }],
		['top-cards', 'playerListId', 7, { topN: 4 }],
		['standings', 'headerText', 'Final Standings', { rowsPerPage: 6 }],
		['standings', 'playerListId', 7, { rowsPerPage: 6 }],
		['player-history', 'headerText', 'Match History', { rowsPerPage: 6 }],
		['player-history', 'playerId', 5, { rowsPerPage: 6 }],
	])('clearing %s %s', (mode, field, storedValue, unrelated) => {
		it.each([
			['null, the deletion the PATCH contract defines', null],
			['undefined, which JSON would omit', undefined],
		])('as %s deletes it, keeps the rest, and reads the default from then on', async (_, cleared) => {
			const declared = fieldOf(getDefaultConfigForMode(mode), field);
			const server = await openScreen(createMockScreen({
				id: 1,
				eventId: 1,
				stateVersion: 1,
				modeConfigs: { [mode]: { ...unrelated, [field]: storedValue } },
			}));
			const scope = effectScope();
			const { config, updateConfig } = scope.run(() => useModeConfigUpdate(1, 1, mode))!;
			expect(fieldOf(config.value, field)).toBe(storedValue);

			updateConfig({ [field]: cleared } as never);
			expect(fieldOf(config.value, field)).toBe(declared);
			await sendPending();

			expect(server.bodies).toEqual([{ [field]: null, stateVersion: 1 }]);
			expect(server.held.modeConfigs).toEqual({ [mode]: unrelated });
			expect(fieldOf(config.value, field)).toBe(declared);
			scope.stop();

			const reloaded = await reloadedConfig(mode);
			expect(fieldOf(reloaded, field)).toBe(declared);
			expect(reloaded).toMatchObject(unrelated);
		});
	});

	it('a display reset clears a custom header rather than leaving the old one stored', async () => {
		const server = await openScreen(createMockScreen({
			id: 1,
			eventId: 1,
			stateVersion: 1,
			modeConfigs: { metagame: { headerText: 'Day 2 Metagame', archetypeFilter: 'Rakdos Midrange' } },
		}));
		const scope = effectScope();
		const { config, resetConfig } = scope.run(() => useModeConfigUpdate(1, 1, 'metagame'))!;

		resetConfig();
		await sendPending();

		// The header is a display setting; the Archetype filter is what the Screen points at.
		expect(server.held.modeConfigs?.metagame).not.toHaveProperty('headerText');
		expect(server.held.modeConfigs?.metagame).toMatchObject({ archetypeFilter: 'Rakdos Midrange' });
		expect(config.value.headerText).toBeUndefined();
		scope.stop();
	});
});
