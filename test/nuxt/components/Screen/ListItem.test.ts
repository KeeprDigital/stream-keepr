import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ScreenListItem from '~/components/Screen/ListItem.vue';

// The mode registry pulls in every mode's components, none of which bear on this card.
vi.mock('~/modules/screen-mode', () => ({
	getScreenModeDisplayType: vi.fn(() => 'overlay'),
	getScreenModeIcon: vi.fn(() => 'i-lucide-monitor'),
	getScreenModeLabel: vi.fn((mode: string) => mode),
	getScreenModeSelectOptions: vi.fn(() => []),
}));

enableAutoUnmount(afterEach);

const { apiFetch } = vi.hoisted(() => ({
	apiFetch: vi.fn(),
}));
const copyToClipboard = vi.fn();
const toastAdd = vi.fn();
const screenPresence = {
	value: new Map<number, { count: number; members: Array<{ data?: { cardData?: string } }> }>(),
};

mockNuxtImport('$fetch', () => apiFetch);
mockNuxtImport('useCopyToClipboard', () => () => ({ copyToClipboard }));
mockNuxtImport('useToast', () => () => ({ add: toastAdd }));
mockNuxtImport('navigateTo', () => vi.fn());
mockNuxtImport('useScreenStore', () => () => ({ screenPresence: screenPresence.value }));

const screen = {
	id: 4,
	eventId: 2,
	name: 'Stage Left',
	slug: 'stage-left',
	currentMode: 'background',
	modeConfigs: null,
	stateVersion: 1,
	createdAt: new Date('2026-01-01'),
	updatedAt: new Date('2026-01-01'),
} as unknown as Screen;

async function mountItem() {
	const wrapper = mount(ScreenListItem, {
		props: {
			screen,
			eventId: 2,
			connectedCount: 0,
			isUpdating: false,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				NuxtLink: { template: '<a><slot /></a>' },
				ScreenTypeBadge: true,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

type Wrapper = Awaited<ReturnType<typeof mountItem>>;

function menuItems(wrapper: Wrapper) {
	return wrapper.findAllComponents({ name: 'UDropdownMenu' })
		.flatMap(menu => (menu.props('items') as Array<Array<{ label: string; description?: string; onSelect: (event: Event) => void }>>).flat());
}

async function choose(wrapper: Wrapper, label: string) {
	menuItems(wrapper).find(item => item.label === label)!.onSelect(new Event('select'));
	await flushPromises();
}

function presence(...cardData: Array<string | undefined>) {
	screenPresence.value = new Map([
		[
			4,
			{
				count: cardData.length,
				members: cardData.map(value => ({
					data: value
						? { cardData: value }
						: {},
				})),
			},
		],
	]);
}

describe('screen list item — card data health badge (#465)', () => {
	beforeEach(() => {
		apiFetch.mockReset().mockResolvedValue({});
	});

	it('counts the outputs reporting degraded card data, and says what is happening', async () => {
		presence('degraded', 'degraded', 'complete');

		const wrapper = await mountItem();

		const badge = wrapper.get('[data-testid="card-data-degraded-badge"]');
		expect(badge.text()).toContain('2');
		expect(wrapper.get('[data-tooltip*="Scryfall"]').attributes('data-tooltip')).toContain('re-fetching until Scryfall answers');
	});

	it.each([
		[
			'every reporting output is complete',
			['complete'],
		],
		[
			'an output reports nothing',
			[undefined],
		],
	])('shows no badge when %s', async (_, reports) => {
		presence(...reports);

		const wrapper = await mountItem();

		expect(wrapper.find('[data-testid="card-data-degraded-badge"]').exists()).toBe(false);
	});
});

// How a hand-out obtains and carries the Screen Output Asset Capability is
// `useScreenOutputAccessUrl`'s test; here the card wires its two controls to it
// and says what each outcome means.
describe('screen list item — handing out this Screen’s output', () => {
	let capability: string | null;

	beforeEach(() => {
		capability = 'list-capability';
		apiFetch.mockReset().mockImplementation(async (path: string) => {
			if (!String(path).endsWith('/asset-capability'))
				return {};
			if (!capability)
				throw new Error('no capability');
			return { assetCapability: capability };
		});
		toastAdd.mockClear();
		copyToClipboard.mockClear();
		screenPresence.value = new Map();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const accessUrl = `${window.location.origin}/event/2/screen/stage-left?output=overlay#asset-capability=list-capability`;

	it('copies the output URL carrying asset access', async () => {
		const wrapper = await mountItem();

		await choose(wrapper, 'Copy output URL');

		expect(copyToClipboard).toHaveBeenCalledWith(accessUrl, expect.objectContaining({ successTitle: 'Output URL copied' }));
	});

	it('copies nothing, and names why, when asset access cannot be obtained', async () => {
		capability = null;
		const wrapper = await mountItem();

		await choose(wrapper, 'Copy output URL');

		expect(copyToClipboard).toHaveBeenCalledWith('', expect.objectContaining({
			nothingToCopyDescription: expect.stringContaining('Asset access for this Screen could not be obtained'),
		}));
	});

	it('opens the output at the URL carrying asset access', async () => {
		const outputWindow = {
			opener: {} as unknown,
			location: { href: '' },
			close: vi.fn(),
		};
		vi.stubGlobal('open', vi.fn(() => outputWindow));
		const wrapper = await mountItem();

		await choose(wrapper, 'Open output');

		expect(outputWindow.location.href).toBe(accessUrl);
		expect(toastAdd).not.toHaveBeenCalled();
	});

	// The two failures ask for opposite things — retry, or change a browser setting (#258).
	it.each([
		[
			'asset access is refused',
			() => {
				capability = null;
				vi.stubGlobal('open', vi.fn(() => ({
					opener: {},
					location: { href: '' },
					close: vi.fn(),
				})));
			},
			'Asset access for this Screen could not be obtained',
		],
		[
			'the browser blocks the window',
			() => vi.stubGlobal('open', vi.fn(() => null)),
			'pop-up',
		],
	])('says once why no output opened when %s', async (_, arrange, reason) => {
		arrange();
		const wrapper = await mountItem();

		await choose(wrapper, 'Open output');

		expect(toastAdd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
			title: 'Output not opened',
			description: expect.stringContaining(reason),
		}));
	});

	// The card prints the bare address, which resolves no media (#231), so both
	// controls name what they hand out (#266).
	it('names both hand-outs by what they carry, apart from the bare address it prints', async () => {
		const wrapper = await mountItem();

		const handOuts = menuItems(wrapper).filter(item => ['Copy output URL', 'Open output'].includes(item.label));
		expect(handOuts).toHaveLength(2);
		expect(handOuts.every(item => item.description?.includes('asset access'))).toBe(true);
		expect(wrapper.text()).toContain(`${window.location.origin}/event/2/screen/stage-left`);
		expect(wrapper.text()).not.toContain('asset-capability=');
	});
});
