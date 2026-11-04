import type { TcgPlusImportAnswer, TcgPlusImportPreview } from '~~/shared/types/tcgPlusImport';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { lastCallTo } from '~~/test/helpers/lastCallTo';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import TcgPlusImport from '~/components/Sync/TcgPlusImport.vue';

// An OP Event's Sync page: the TCG+ Import's preview, confirm and failure states.
// The routes are faked at `$fetch`.

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useEventStore', () => () => ({
	eventId: 7,
	event: { id: 7, game: 'op' },
}));

const CSV = 'チームID,会員番号,ニックネーム\n';

const PREVIEW: TcgPlusImportPreview = {
	playerCount: 3,
	added: [
		{ memberNumber: '0001', nickname: 'ana', leaderNumber: 'OP01-001' },
	],
	deckListChanged: [
		{ playerId: 4, shownAs: 'Ben', memberNumber: '0002' },
	],
	deactivated: [],
	leaders: [
		{
			number: 'OP01-001',
			name: 'Roronoa Zoro',
			colors: ['Red'],
			playerCount: 2,
		},
		{
			number: 'OP99-001',
			name: null,
			colors: [],
			playerCount: 1,
		},
	],
	warnings: {
		ruleBreaches: [],
		unknownCards: [
			{ number: 'OP99-001', playerCount: 1 },
		],
		handEditConflicts: [
			{ playerId: 5, shownAs: 'cal', memberNumber: '0003' },
		],
		possibleDuplicates: [],
	},
};

const ANSWER: TcgPlusImportAnswer = {
	success: true,
	message: 'Imported 3 Players from TCG+; 2 Deck Lists written',
	results: {
		created: 1,
		updated: 0,
		deactivated: 0,
		deckListsWritten: 2,
		handEditsKept: 1,
	},
};

function mountImport() {
	return mount(TcgPlusImport, {
		global: {
			stubs: {
				...nuxtUiStubs,
				NuxtLayout: { template: '<div><slot /></div>' },
				OpColorDisplay: true,
			},
		},
	});
}

async function chooseExport(wrapper: ReturnType<typeof mountImport>) {
	const input = wrapper.get('input[type="file"]');
	Object.defineProperty(input.element, 'files', {
		value: [
			new File([CSV], 'sydney.csv', { type: 'text/csv' }),
		],
		configurable: true,
	});
	await input.trigger('change');
	await flushPromises();
}

function status(wrapper: ReturnType<typeof mountImport>) {
	return wrapper.get('[data-tcgplus-import]').attributes('data-status');
}

function button(wrapper: ReturnType<typeof mountImport>, label: string) {
	return wrapper.findAll('button').find(candidate => candidate.text().includes(label))!;
}

describe('the TCG+ Import', () => {
	beforeEach(() => {
		mockFetch.mockReset();
	});

	it('previews the chosen export, sending its text, while showing it is busy', async () => {
		const pending = deferred<TcgPlusImportPreview>();
		mockFetch.mockReturnValue(pending.promise);
		const wrapper = mountImport();

		await chooseExport(wrapper);

		expect(status(wrapper)).toBe('previewing');
		expect(button(wrapper, 'Choose export').attributes('aria-busy')).toBe('true');
		expect(lastCallTo(mockFetch, '/api/events/7/tcgplus/preview')[1]).toMatchObject({
			method: 'POST',
			body: { csv: CSV },
		});

		pending.resolve(PREVIEW);
		await flushPromises();

		expect(status(wrapper)).toBe('previewed');
		expect(wrapper.get('[data-file-name]').text()).toBe('sydney.csv');
		expect(wrapper.findAll('[data-preview-group]').map(group => [
			group.attributes('data-preview-group'),
			group.attributes('data-count'),
		])).toEqual([
			['added', '1'],
			['deckListChanged', '1'],
			['deactivated', '0'],
		]);
		expect(wrapper.findAll('[data-preview-leader]').map(leader => [
			leader.attributes('data-number'),
			leader.attributes('data-count'),
		])).toEqual([
			['OP01-001', '2'],
			['OP99-001', '1'],
		]);
		expect(wrapper.findAll('[data-preview-warning]').map(warning => warning.attributes('data-preview-warning'))).toEqual(['unknownCards', 'handEditConflicts']);
	});

	it('imports the previewed export only once confirmed, and says what it did', async () => {
		mockFetch.mockResolvedValueOnce(PREVIEW);
		const wrapper = mountImport();
		await chooseExport(wrapper);
		const pending = deferred<TcgPlusImportAnswer>();
		mockFetch.mockReturnValueOnce(pending.promise);

		await button(wrapper, 'Import 3 Players').trigger('click');

		expect(status(wrapper)).toBe('importing');
		expect(lastCallTo(mockFetch, '/api/events/7/tcgplus/import')[1]).toMatchObject({
			method: 'POST',
			body: { csv: CSV },
		});
		pending.resolve(ANSWER);
		await flushPromises();

		expect(status(wrapper)).toBe('imported');
		expect(wrapper.get('[data-tcgplus-imported]').text()).toContain(ANSWER.message);
		expect(wrapper.find('[data-preview-group]').exists()).toBe(false);
	});

	it('cancels a preview without importing', async () => {
		mockFetch.mockResolvedValueOnce(PREVIEW);
		const wrapper = mountImport();
		await chooseExport(wrapper);

		await button(wrapper, 'Cancel').trigger('click');

		expect(status(wrapper)).toBe('idle');
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it.each([
		['the preview', 0, 'The export could not be previewed'],
		['the import', 1, 'The import failed; nothing was saved'],
	])('shows why %s failed', async (_label, failingCall, title) => {
		const failure = transportFailure({
			status: 422,
			body: { message: 'This is not a TCG+ deck list export.' },
		});
		const answers = [PREVIEW, ANSWER];
		answers.forEach((answer, index) => index === failingCall
			? mockFetch.mockRejectedValueOnce(failure)
			: mockFetch.mockResolvedValueOnce(answer));
		const wrapper = mountImport();
		await chooseExport(wrapper);
		if (failingCall === 1) {
			await button(wrapper, 'Import 3 Players').trigger('click');
			await flushPromises();
		}

		expect(status(wrapper)).toBe('failed');
		const alert = wrapper.get('[data-tcgplus-error]');
		expect(alert.text()).toContain(title);
		expect(alert.text()).toContain('This is not a TCG+ deck list export.');
		expect(wrapper.find('[data-tcgplus-imported]').exists()).toBe(false);
	});
});
