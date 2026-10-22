/**
 * The contract of the unbundled-icon guard (#779): a Nuxt test that renders an
 * icon the test client bundle lacks fails, with a message naming the icon, in
 * the test that rendered it, and `@nuxt/icon` never logs its asynchronous
 * `[Icon] failed to load icon` line, the one that lands at worker teardown as
 * an `EnvironmentTeardownError` (#766, vitest-dev/vitest#11153).
 */

import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, onTestFailed, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { UIcon } from '#components';
import { assertEveryIconBundled } from './failOnUnbundledIcon';

const UNBUNDLED = 'i-lucide-not-in-the-client-bundle';

/**
 * Long enough for an unguarded load to have failed and logged: Iconify rejects
 * a missing icon within a few ticks, and without the guard this window caught
 * the `[Icon] failed to load icon` line every time.
 */
async function settle() {
	await flushPromises();
	await new Promise(resolve => setTimeout(resolve, 50));
	await flushPromises();
}

function iconHost(name: string) {
	return defineComponent({
		setup: () => () => h(UIcon, { name }),
	});
}

describe('unbundled icon guard', () => {
	it('names an icon the test client bundle lacks', async () => {
		await mountSuspended(iconHost(UNBUNDLED));

		expect(() => assertEveryIconBundled()).toThrow('`lucide:not-in-the-client-bundle`');
	});

	it('passes an icon the bundle holds', async () => {
		await mountSuspended(iconHost('i-lucide-check'));

		expect(() => assertEveryIconBundled()).not.toThrow();
	});

	it('keeps @nuxt/icon from logging the failure', async () => {
		const warn = vi.spyOn(console, 'warn');

		await mountSuspended(iconHost(UNBUNDLED));
		await settle();

		expect(warn).not.toHaveBeenCalled();
		expect(() => assertEveryIconBundled()).toThrow();
	});

	describe('left to the guard\'s own afterEach', () => {
		let failure: string | undefined;

		it.fails('fails the test that renders an unbundled icon', async () => {
			onTestFailed(({ task }) => {
				failure = task.result?.errors?.map(error => error.message).join('\n');
			});
			await mountSuspended(iconHost(UNBUNDLED));
		});

		it('names the icon and the test that rendered it', () => {
			expect(failure).toContain('`lucide:not-in-the-client-bundle`');
			expect(failure).toContain('rendered in "unbundled icon guard > left to the guard\'s own afterEach > fails the test that renders an unbundled icon"');
		});
	});
});
