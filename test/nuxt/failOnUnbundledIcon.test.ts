/**
 * The contract of the unbundled-icon guard (#779): a Nuxt test that renders an
 * icon the test client bundle lacks fails, with a message naming the icon, in
 * the test that rendered it, and `@nuxt/icon` never logs its asynchronous
 * `[Icon] failed to load icon` line, the one that lands at worker teardown as
 * an `EnvironmentTeardownError` (#766, vitest-dev/vitest#11153).
 */

import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { UIcon } from '#components';
import { assertEveryIconBundled } from './failOnUnbundledIcon';

const UNBUNDLED = 'i-lucide-not-in-the-client-bundle';

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
		await flushPromises();
		await new Promise(resolve => setTimeout(resolve, 50));

		expect(warn).not.toHaveBeenCalled();
		expect(() => assertEveryIconBundled()).toThrow();
	});

	// The end-to-end proof: left to the guard's own `afterEach`, the test fails.
	it.fails('fails the test that renders an unbundled icon', async () => {
		await mountSuspended(iconHost(UNBUNDLED));
	});
});
