import type {
	GraphicsAssetEvidenceEntry,
	GraphicsAssetEvidencePage,
} from '~~/shared/types/graphicsAsset';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { lastCallTo } from '~~/test/helpers/lastCallTo';

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

mockNuxtImport('$fetch', () => mockApiFetch);

function entry(
	overrides: Partial<GraphicsAssetEvidenceEntry> = {},
): GraphicsAssetEvidenceEntry {
	return {
		id: 'entry-1',
		recordedAt: '2026-07-30T09:00:00.000Z',
		category: 'graphic-asset-trashed',
		actor: 'librarian',
		subject: { kind: 'graphic-asset', id: 'asset-1' },
		outcome: 'graphic-asset-trashed',
		reason: 'trash-recovery-window-opened',
		correlationId: 'correlation-1',
		detail: {
			transition: { from: 'active', to: 'trashed' },
			deadline: '2026-08-29T09:00:00.000Z',
			referenceCount: 0,
		},
		expiresAt: null,
		...overrides,
	};
}

function ledger(overrides: Partial<GraphicsAssetEvidencePage> = {}): GraphicsAssetEvidencePage {
	return {
		entries: [
			entry(),
			entry({
				id: 'entry-2',
				recordedAt: '2026-07-30T08:00:00.000Z',
				category: 'content-deleted',
				actor: 'graphics-retention-policy',
				subject: { kind: 'graphic-asset-content', id: 'content-1' },
				outcome: 'content-deleted',
				reason: 'unreachable-after-quarantine-recheck',
				correlationId: 'correlation-2',
				detail: { bytesFreed: 2048, canonicalPressure: 'normal' },
				expiresAt: '2027-07-30T08:00:00.000Z',
			}),
		],
		older: { recordedAt: '2026-07-30T08:00:00.000Z', id: 'entry-2' },
		newer: null,
		...overrides,
	};
}

const passthroughStub = defineComponent({
	template: '<div><slot name="actions" /><slot name="header" /><slot /><slot name="footer" /></div>',
});
const alertStub = defineComponent({
	props: ['title', 'description'],
	template: '<div>{{ title }}{{ description }}<slot /></div>',
});
const badgeStub = defineComponent({
	props: ['label'],
	template: '<span><slot />{{ label }}</span>',
});
const buttonStub = defineComponent({
	props: ['label', 'disabled', 'to'],
	emits: ['click'],
	template: `<button
		:disabled="disabled"
		:data-to="to ? to.path + '?queue=' + to.query.queue + '&item=' + to.query.item : undefined"
		@click="$emit('click')"
	><slot />{{ label }}</button>`,
});
const formFieldStub = defineComponent({
	props: ['label', 'description'],
	template: '<div><label>{{ label }}</label><p>{{ description }}</p><slot /></div>',
});
const inputStub = defineComponent({
	props: ['modelValue', 'type', 'placeholder'],
	emits: ['update:modelValue'],
	template: `<input
		:value="modelValue"
		:type="type"
		:placeholder="placeholder"
		@input="$emit('update:modelValue', $event.target.value)"
	>`,
});
const selectStub = defineComponent({
	props: ['modelValue', 'items'],
	emits: ['update:modelValue'],
	template: `<select :value="modelValue" @change="$emit('update:modelValue', $event.target.value)">
		<option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option>
	</select>`,
});

async function mountPage() {
	const { default: EvidencePage } = await import('../../../../../app/pages/admin/graphics-assets/evidence.vue');
	return mount(EvidencePage, {
		global: {
			stubs: {
				NuxtLayout: passthroughStub,
				UAlert: alertStub,
				UButton: buttonStub,
				UCard: passthroughStub,
				UBadge: badgeStub,
				UIcon: passthroughStub,
				UFormField: formFieldStub,
				UInput: inputStub,
				USelect: selectStub,
			},
		},
	});
}

/** Lets the page's own fetches resolve before anything is asserted about it. */
async function settle() {
	await nextTick();
	await new Promise(resolve => setTimeout(resolve, 0));
	await nextTick();
}

function buttonNamed(wrapper: Awaited<ReturnType<typeof mountPage>>, label: string) {
	return wrapper.findAll('button').find(button => button.text() === label);
}

/** Enters the administrator token and takes the first reading, as an administrator does. */
async function openLedger() {
	const wrapper = await mountPage();
	await wrapper.find('input').setValue('admin-token');
	await buttonNamed(wrapper, 'Open the ledger')!.trigger('click');
	await settle();
	return wrapper;
}

/** Types into the correlation field without applying it. */
async function typeCorrelation(
	wrapper: Awaited<ReturnType<typeof mountPage>>,
	value: string,
) {
	await wrapper.findAll('input')
		.find(input => input.attributes('placeholder') === 'Opaque identity')!
		.setValue(value);
}

const LEDGER_ENDPOINT = '/api/admin/graphics-assets/evidence';

/**
 * The last question put to the ledger endpoint, chosen by name rather than
 * taken from the end of the list. The end of the list is not reliably the
 * page's: Nuxt's global route middleware starts a clock sync that puts
 * `/api/time` samples through this same `$fetch` mock (#123), and two of them
 * land on every mount here. A stray arriving last would pass an emptiness
 * check, hand back a sample's options, and return `undefined` for a query
 * nobody asked.
 *
 * That reading, and the named error when the ledger was never asked at all, are
 * now `lastCallTo`'s — this site is where the selection-not-guard rule was
 * learned (#273), and #280 generalised it.
 */
function lastQuery() {
	const [, options] = lastCallTo(mockApiFetch, LEDGER_ENDPOINT);
	return options.query;
}

describe('the Graphics Asset Library Evidence ledger page', () => {
	beforeEach(() => {
		mockApiFetch.mockReset();
		mockApiFetch.mockResolvedValue(ledger());
	});

	// A test that installs fake timers must not leave them installed for the
	// next one, whether it finished or timed out.
	afterEach(() => {
		vi.useRealTimers();
	});

	it('refuses to read anything before an administrator token is given', async () => {
		const wrapper = await mountPage();

		expect(wrapper.text()).toContain('Graphics Administrator access');
		expect(wrapper.text()).not.toContain('graphic-asset-trashed');
		// Nuxt itself reaches for $fetch while the app sets up, so what matters is
		// that the ledger was not among the things asked for.
		expect(mockApiFetch).not.toHaveBeenCalledWith(
			'/api/admin/graphics-assets/evidence',
			expect.anything(),
		);
	});

	it('shows the ledger chronologically with the deadline each entry established', async () => {
		const wrapper = await openLedger();

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/admin/graphics-assets/evidence',
			expect.objectContaining({ headers: { 'x-graphics-admin-token': 'admin-token' } }),
		);
		const text = wrapper.text();
		// Newest first: the Trash transition was recorded after the byte deletion.
		expect(text.indexOf('graphic-asset-trashed')).toBeLessThan(text.indexOf('content-deleted'));
		expect(text).toContain('trash-recovery-window-opened');
		expect(text).toContain('active → trashed');
		// The deadline Trash established is shown with the Evidence that set it.
		expect(text).toContain('Deadline');
		expect(text).toContain(new Date('2026-08-29T09:00:00.000Z').toLocaleString());
		// An unsealed entry says it is retained rather than showing a false date.
		expect(text).toContain('its subject is cleaned up');
		expect(text).toContain(new Date('2027-07-30T08:00:00.000Z').toLocaleString());
	});

	it('narrows by category group and starts the answer at the newest end', async () => {
		const wrapper = await openLedger();

		await buttonNamed(wrapper, 'Lifecycle')!.trigger('click');
		await buttonNamed(wrapper, 'Apply')!.trigger('click');
		await settle();

		expect(lastQuery()).toMatchObject({ group: ['lifecycle'], limit: 25 });
		// A new question is asked from the top rather than from wherever the
		// previous answer had been paged to.
		expect(lastQuery().cursorId).toBeUndefined();
	});

	it('asks only the question that was applied, however the form is edited', async () => {
		// The reading refreshes on a timer, and every refresh goes through the
		// same read closure. Advancing the clock exercises the poll itself;
		// shouldAdvanceTime keeps the zero-delay awaits in settle() resolving.
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const wrapper = await openLedger();
		const asked = mockApiFetch.mock.calls.length;

		// A half-typed identity is exactly what a tick would otherwise submit,
		// and an audit surface answering "no Evidence matches" in the middle of
		// a word invites precisely the wrong conclusion.
		await typeCorrelation(wrapper, 'correl');

		await vi.advanceTimersByTimeAsync(5000);
		await settle();

		expect(mockApiFetch.mock.calls.length).toBeGreaterThan(asked);
		expect(lastQuery()).not.toHaveProperty('correlationId');
	});

	it('resets the position when a new question is applied', async () => {
		const wrapper = await openLedger();

		await buttonNamed(wrapper, 'Older')!.trigger('click');
		await settle();
		expect(lastQuery()).toHaveProperty('cursorId', 'entry-2');

		await typeCorrelation(wrapper, 'correlation-1');
		await buttonNamed(wrapper, 'Apply')!.trigger('click');
		await settle();

		// A position within the answer to one question means nothing to another.
		expect(lastQuery()).toMatchObject({ correlationId: 'correlation-1' });
		expect(lastQuery()).not.toHaveProperty('cursorId');
	});

	it('turns pages by the entry each one ended on rather than by an offset', async () => {
		const wrapper = await openLedger();

		expect(buttonNamed(wrapper, 'Newer')!.attributes('disabled')).toBeDefined();
		await buttonNamed(wrapper, 'Older')!.trigger('click');
		await settle();

		expect(lastQuery()).toMatchObject({
			cursorRecordedAt: '2026-07-30T08:00:00.000Z',
			cursorId: 'entry-2',
			direction: 'older',
		});
		expect(lastQuery()).not.toHaveProperty('offset');
	});

	it('follows one entry to everything about its subject, operation, or actor', async () => {
		const wrapper = await openLedger();

		await wrapper.findAll('button').find(button => button.text() === 'This subject')!.trigger('click');
		await settle();
		expect(lastQuery()).toMatchObject({
			subjectKind: 'graphic-asset',
			subjectId: 'asset-1',
		});

		await wrapper.findAll('button').find(button => button.text() === 'Same operation')!.trigger('click');
		await settle();
		// Following a thread replaces the question rather than narrowing it, so
		// the subject filter does not survive into the correlation one.
		expect(lastQuery()).toMatchObject({ correlationId: 'correlation-1' });
		expect(lastQuery()).not.toHaveProperty('subjectId');

		await wrapper.findAll('button').find(button => button.text() === 'Same actor')!.trigger('click');
		await settle();
		expect(lastQuery()).toMatchObject({ actor: 'librarian' });
		expect(lastQuery()).not.toHaveProperty('correlationId');
	});

	it('offers the queue inspector only where the subject still exists', async () => {
		const wrapper = await openLedger();

		const links = wrapper.findAll('button')
			.filter(button => button.text() === 'Inspect in queues');
		// The Trash entry has a subject still sitting in a queue; the deleted
		// content does not, and a link to it would only ever answer 404.
		expect(links).toHaveLength(1);
		expect(links[0]!.attributes('data-to'))
			.toBe('/admin/graphics-assets/queues?queue=trashed-asset&item=asset-1');
	});

	it('explains a purged identity with its tombstone', async () => {
		mockApiFetch.mockResolvedValue(ledger({
			entries: [],
			older: null,
			tombstone: {
				assetId: 'asset-1' as never,
				purgedAt: '2026-07-30T09:00:00.000Z',
				reason: 'early-purge',
				revisionCount: 3,
				referenceCount: 0,
			},
		}));
		const wrapper = await openLedger();

		const text = wrapper.text();
		expect(text).toContain('This Graphic Asset was purged');
		expect(text).toContain('early-purge');
		expect(text).toContain('3 revisions removed against 0 references');
		// The ledger being empty for a purged identity means something different
		// from it being empty for one that never existed.
		expect(text).toContain('satisfies no Graphic Asset Reference');
	});

	it('drops the reading when the token stops being accepted', async () => {
		const wrapper = await openLedger();
		expect(wrapper.text()).toContain('graphic-asset-trashed');

		mockApiFetch.mockRejectedValue({ statusCode: 403, message: 'Forbidden' });
		await buttonNamed(wrapper, 'Refresh')!.trigger('click');
		await settle();

		expect(wrapper.text()).not.toContain('graphic-asset-trashed');
		expect(wrapper.text()).toContain('Graphics Administrator access');
	});
});
