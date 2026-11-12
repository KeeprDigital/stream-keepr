import type { VueWrapper } from '@vue/test-utils';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import OutputHandOut from '~/components/Screen/OutputHandOut.vue';

const toastAdd = vi.fn();
const { apiFetch } = vi.hoisted(() => ({
	apiFetch: vi.fn(),
}));

mockNuxtImport('useToast', () => () => ({ add: toastAdd }));
mockNuxtImport('$fetch', () => apiFetch);

const capability = 'HG7fQ2mS4kLp9xRt0ZbNvCyE1JdWqUoA3hMi5nTgKrs';
const writeText = vi.fn(async () => {});

function accessUrl(output: ScreenOutput) {
	return `${window.location.origin}/event/1/screen/main?output=${output}#asset-capability=${capability}`;
}

function mountHandOut(props: { outputs?: ScreenOutput[]; disabled?: boolean; disabledReason?: string } = {}) {
	return mount(OutputHandOut, {
		props: {
			eventId: 1,
			screen: { id: 7, slug: 'main' },
			...props,
		},
		global: { stubs: nuxtUiStubs },
	});
}

function stubOutputWindow() {
	const outputWindow = {
		opener: {} as unknown,
		location: { href: '' },
		close: vi.fn(),
	};
	vi.stubGlobal('open', vi.fn(() => outputWindow));
	return outputWindow;
}

/** Clicks the control, and chooses `item` from its menu when the hand-out offers one. */
async function handOut(wrapper: VueWrapper, control: 'open' | 'copy', item?: string) {
	await wrapper.get(`[data-hand-out="${control}"]`).trigger('click');
	if (item) {
		const entry = wrapper.findAll('[role="menuitem"]').find(candidate => candidate.text() === item);
		if (!entry)
			throw new Error(`No menu item "${item}" behind ${control}`);
		await entry.trigger('click');
	}
	await flushPromises();
}

beforeEach(() => {
	vi.clearAllMocks();
	apiFetch.mockResolvedValue({ assetCapability: capability });
	vi.stubGlobal('navigator', {
		...navigator,
		clipboard: { writeText },
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// How the capability is obtained per hand-out is `useScreenOutputAccessUrl`'s test;
// this one owns which output each control hands out and the words for each outcome.
describe('a Screen Output hand-out', () => {
	it.each([
		[
			'the output, with no outputs of its own',
			undefined,
			undefined,
			'overlay',
		],
		[
			'a chosen output',
			['overlay', 'fill', 'key'] as ScreenOutput[],
			'Open key output',
			'key',
		],
		[
			'the output from the menu',
			['overlay', 'fill', 'key'] as ScreenOutput[],
			'Open output',
			'overlay',
		],
	])('opens %s in a tab it points once asset access is in hand', async (_, outputs, item, output) => {
		const outputWindow = stubOutputWindow();
		const wrapper = mountHandOut({ outputs });

		await handOut(wrapper, 'open', item);

		expect(apiFetch).toHaveBeenCalledWith('/api/events/1/screens/7/asset-capability');
		expect(outputWindow.opener).toBeNull();
		expect(outputWindow.location.href).toBe(accessUrl(output as ScreenOutput));
		expect(toastAdd).not.toHaveBeenCalled();
	});

	it.each([
		[
			'the output, with no outputs of its own',
			undefined,
			undefined,
			'overlay',
			'Output URL copied',
		],
		[
			'a chosen output',
			['overlay', 'fill', 'key'] as ScreenOutput[],
			'Copy fill output URL',
			'fill',
			'Fill output URL copied',
		],
		[
			'the output from the menu',
			['overlay', 'fill', 'key'] as ScreenOutput[],
			'Copy output URL',
			'overlay',
			'Output URL copied',
		],
	])('copies %s with asset access, and says what it carries', async (_, outputs, item, output, title) => {
		const wrapper = mountHandOut({ outputs });

		await handOut(wrapper, 'copy', item);

		expect(writeText).toHaveBeenCalledExactlyOnceWith(accessUrl(output as ScreenOutput));
		expect(toastAdd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
			title,
			description: expect.stringContaining('asset access'),
			color: 'success',
		}));
	});

	// A refusal and a blocked tab are opposite instructions — retry, or allow pop-ups —
	// so each is said in its own words, and neither is blamed on the clipboard.
	it.each([
		[
			'opens nothing when asset access is refused',
			'open',
			() => {
				apiFetch.mockRejectedValue(new Error('unavailable'));
				stubOutputWindow();
			},
			'Output not opened',
			'Asset access for this Screen could not be obtained',
		],
		[
			'names the browser when it blocks the tab',
			'open',
			() => vi.stubGlobal('open', vi.fn(() => null)),
			'Output not opened',
			'Allow pop-ups for this site',
		],
		[
			'copies nothing when asset access is refused',
			'copy',
			() => apiFetch.mockRejectedValue(new Error('unavailable')),
			'Nothing copied',
			'Asset access for this Screen could not be obtained',
		],
	] as const)('%s, and says why', async (_, control, arrange, title, reason) => {
		arrange();
		const wrapper = mountHandOut();

		await handOut(wrapper, control);

		expect(writeText).not.toHaveBeenCalled();
		expect(toastAdd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
			title,
			description: expect.stringContaining(reason),
			color: 'error',
		}));
	});

	it('closes the tab it opened, unpointed, when asset access is refused', async () => {
		apiFetch.mockRejectedValue(new Error('unavailable'));
		const outputWindow = stubOutputWindow();
		const wrapper = mountHandOut();

		await handOut(wrapper, 'open');

		expect(outputWindow.close).toHaveBeenCalledOnce();
		expect(outputWindow.location.href).toBe('');
	});

	it.each([
		['no outputs of its own', undefined],
		[
			'outputs of its own',
			['overlay', 'fill', 'key'] as ScreenOutput[],
		],
	])('hands nothing out, and says why, while disabled, with %s', async (_, outputs) => {
		stubOutputWindow();
		const wrapper = mountHandOut({ outputs, disabled: true, disabledReason: 'A pinned revision is missing.' });

		for (const control of ['open', 'copy'] as const) {
			const button = wrapper.get(`[data-hand-out="${control}"]`);
			expect(button.attributes('disabled')).toBeDefined();
			expect(button.attributes('title')).toBe('A pinned revision is missing.');
			await button.trigger('click');
		}
		await flushPromises();

		expect(wrapper.find('[role="menu"]').exists()).toBe(false);
		expect(window.open).not.toHaveBeenCalled();
		expect(writeText).not.toHaveBeenCalled();
	});
});
