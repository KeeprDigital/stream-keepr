import type { ScreenPresenceData } from '~/types/screen';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { reactive, ref } from 'vue';

/** The Screen Outputs currently open, as the Screen's presence channel reports them. */
const presence = ref(new Map<number, { count: number; members: unknown[] }>());

mockNuxtImport('useScreenStore', () => () => reactive({ screenPresence: presence }));

function output(userAgent: string | undefined, screenId = 3): { data: ScreenPresenceData } {
	return { data: { screenId, connectedAt: 0, ...(userAgent === undefined ? {} : { userAgent }) } };
}

const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

describe('the engines of the Screen Outputs currently open', () => {
	beforeEach(() => {
		presence.value = new Map();
	});

	it('names each distinct engine open on this Screen', () => {
		presence.value = new Map([[3, {
			count: 3,
			members: [output(CHROME), output(SAFARI), output(CHROME)],
		}]]);

		const targets = useScreenOutputVideoTargets(3);

		expect([...targets.value].sort()).toEqual(['chromium', 'safari']);
	});

	it('names nothing for a Screen with no output open', () => {
		presence.value = new Map([[4, { count: 1, members: [output(CHROME)] }]]);

		expect(useScreenOutputVideoTargets(3).value).toEqual([]);
	});

	/**
	 * An output that reports no user agent says nothing about what it can play, and
	 * guessing would put a compatibility claim in front of an operator that no
	 * connected browser stands behind.
	 */
	it('says nothing about an output that reports no engine', () => {
		presence.value = new Map([[3, { count: 1, members: [output(undefined)] }]]);

		expect(useScreenOutputVideoTargets(3).value).toEqual([]);
	});

	it('follows the outputs as they open and close', () => {
		const targets = useScreenOutputVideoTargets(3);
		expect(targets.value).toEqual([]);

		presence.value = new Map([[3, { count: 1, members: [output(SAFARI)] }]]);
		expect(targets.value).toEqual(['safari']);

		presence.value = new Map([[3, { count: 0, members: [] }]]);
		expect(targets.value).toEqual([]);
	});
});
