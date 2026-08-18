import type {
	GraphicsOperationalQueuesOverview,
	GraphicsQueueInspectionReading,
} from '~~/shared/types/graphicsAsset';
import type { GraphicsOperationalQueueId } from '~~/shared/utils/graphicsOperationalQueues';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';

const { mockApiFetch, routeQuery, mockRouter } = vi.hoisted(() => {
	const routeQuery = { queue: undefined as string | undefined, item: undefined as string | undefined };
	return {
		mockApiFetch: vi.fn(),
		routeQuery,
		mockRouter: {
			replace: vi.fn((target: { query: Record<string, string | undefined> }) => {
				routeQuery.queue = target.query.queue;
				routeQuery.item = target.query.item;
				return Promise.resolve();
			}),
			// Nuxt's own plugins register navigation guards on the router during
			// setup, so the double has to answer them as well as the page's calls.
			push: vi.fn(() => Promise.resolve()),
			afterEach: vi.fn(() => () => {}),
			beforeEach: vi.fn(() => () => {}),
			beforeResolve: vi.fn(() => () => {}),
			onError: vi.fn(() => () => {}),
			isReady: vi.fn(() => Promise.resolve()),
			resolve: vi.fn((target: unknown) => ({ href: '/', ...(target as object) })),
		},
	};
});

mockNuxtImport('$fetch', () => mockApiFetch);
mockNuxtImport('useRouter', () => () => mockRouter);
mockNuxtImport('useRoute', () => () => reactive({
	path: '/admin/graphics-assets/queues',
	fullPath: '/admin/graphics-assets/queues',
	params: {},
	meta: {},
	query: routeQuery,
}));

function emptyQueue(id: GraphicsOperationalQueueId, severity: 'critical' | 'warning' | 'info') {
	return { id, severity, totalCount: 0, items: [] };
}

/**
 * One item in every queue, so a reading proves each state is rendered on its
 * own terms rather than proving one shape nine times.
 */
function overview(): GraphicsOperationalQueuesOverview {
	return {
		checkedAt: '2026-07-30T09:00:00.000Z',
		authority: {
			expectedReachability: 'catalogue',
			presentBytes: 'byte-store',
			contentAvailabilityFlag: 'advisory-reconciliation-state',
		},
		queues: [
			{
				...emptyQueue('critical-integrity-incident', 'critical'),
				totalCount: 1,
				items: [{
					key: 'critical-integrity-incident:discrepancy-critical',
					queue: 'critical-integrity-incident',
					subject: { kind: 'graphics-discrepancy', id: 'discrepancy-critical' },
					title: 'Sponsor bumper · revision 2',
					referenceCount: 3,
					actions: ['recheck', 'verify-stored-bytes'],
				}],
			},
			{
				...emptyQueue('unavailable-content', 'warning'),
				totalCount: 1,
				items: [{
					key: 'unavailable-content:discrepancy-unavailable',
					queue: 'unavailable-content',
					subject: { kind: 'graphics-discrepancy', id: 'discrepancy-unavailable' },
					title: 'Lower third · revision 1',
					referenceCount: 2,
					actions: ['recheck', 'verify-stored-bytes', 'repair-with-exact-bytes'],
				}],
			},
			{
				...emptyQueue('missing-derivative', 'warning'),
				totalCount: 1,
				items: [{
					key: 'missing-derivative:discrepancy-derivative',
					queue: 'missing-derivative',
					subject: { kind: 'graphics-discrepancy', id: 'discrepancy-derivative' },
					title: 'Graphics Derivative · thumbnail',
					referenceCount: 0,
					actions: ['recheck', 'verify-stored-bytes', 'repair-with-exact-bytes', 'regenerate-derivative'],
				}],
			},
			{
				...emptyQueue('retryable-ingestion', 'warning'),
				totalCount: 1,
				items: [{
					key: 'retryable-ingestion:operation-retryable',
					queue: 'retryable-ingestion',
					subject: { kind: 'graphics-ingestion-operation', id: 'operation-retryable' },
					title: 'Interrupted publication',
					deadline: '2026-08-06T09:00:00.000Z',
					actions: ['retry-ingestion'],
				}],
			},
			{
				...emptyQueue('expired-ingestion-input', 'warning'),
				totalCount: 1,
				items: [{
					key: 'expired-ingestion-input:operation-expired',
					queue: 'expired-ingestion-input',
					subject: { kind: 'graphics-ingestion-operation', id: 'operation-expired' },
					title: 'Abandoned upload',
					deadline: '2026-07-29T09:00:00.000Z',
					actions: [],
				}],
			},
			{
				...emptyQueue('trashed-asset', 'warning'),
				totalCount: 1,
				nextDeadline: '2026-08-29T09:00:00.000Z',
				items: [{
					key: 'trashed-asset:asset-trashed',
					queue: 'trashed-asset',
					subject: { kind: 'graphic-asset', id: 'asset-trashed' },
					title: 'Old sting',
					deadline: '2026-08-29T09:00:00.000Z',
					referenceCount: 0,
					actions: ['restore-graphic-asset', 'purge-now'],
				}],
			},
			{
				...emptyQueue('superseded-revision', 'info'),
				totalCount: 1,
				items: [{
					key: 'superseded-revision:revision-superseded',
					queue: 'superseded-revision',
					subject: { kind: 'graphic-asset-revision', id: 'revision-superseded' },
					title: 'Revision 1',
					deadline: '2026-10-28T09:00:00.000Z',
					referenceCount: 0,
					actions: [],
				}],
			},
			{
				...emptyQueue('quarantined-object', 'info'),
				totalCount: 1,
				items: [{
					key: 'quarantined-object:discrepancy-quarantined',
					queue: 'quarantined-object',
					subject: { kind: 'graphics-discrepancy', id: 'discrepancy-quarantined' },
					title: 'unexpected-canonical-object',
					deadline: '2026-08-06T09:00:00.000Z',
					referenceCount: 0,
					actions: ['recheck'],
				}],
			},
			{
				...emptyQueue('retired-asset', 'info'),
				totalCount: 1,
				items: [{
					key: 'retired-asset:asset-retired',
					queue: 'retired-asset',
					subject: { kind: 'graphic-asset', id: 'asset-retired' },
					title: 'Season one backdrop',
					referenceCount: 1,
					actions: ['restore-graphic-asset'],
				}],
			},
		],
	};
}

function unavailableInspection(): GraphicsQueueInspectionReading {
	return {
		key: 'unavailable-content:discrepancy-unavailable',
		queue: 'unavailable-content',
		severity: 'warning',
		subject: { kind: 'graphics-discrepancy', id: 'discrepancy-unavailable' },
		title: 'Lower third · revision 1',
		authority: {
			expectedReachability: 'catalogue',
			presentBytes: 'byte-store',
			contentAvailabilityFlag: 'advisory-reconciliation-state',
		},
		referenceCount: 2,
		actions: ['recheck', 'verify-stored-bytes', 'repair-with-exact-bytes'],
		detail: {
			kind: 'graphics-discrepancy',
			discrepancy: {
				id: 'discrepancy-unavailable',
				kind: 'unavailable-content',
				state: 'open',
				reasonCode: 'canonical-object-missing',
				isolated: false,
				detectedAt: '2026-07-30T08:00:00.000Z',
				lastCheckedAt: '2026-07-30T08:30:00.000Z',
				expected: { byteLength: 4096, canonicalMime: 'image/png' },
				observed: { present: false },
				affectedUsage: [{
					assetId: 'asset-lower-third' as never,
					assetName: 'Lower third',
					revisionId: 'revision-1' as never,
					revisionNumber: 1,
					kind: 'image',
					lifecycleState: 'active',
					referenceCount: 2,
				}],
				actions: ['recheck', 'verify-stored-bytes', 'repair-with-exact-bytes'],
			},
		},
		evidence: [{
			id: 'evidence-1',
			recordedAt: '2026-07-30T08:00:00.000Z',
			category: 'content-unavailable-detected',
			actor: 'graphics-reconciliation-policy',
			subject: { kind: 'graphics-discrepancy', id: 'discrepancy-unavailable' },
			outcome: 'content-unavailable',
			reason: 'canonical-object-missing',
			correlationId: 'sweep-1',
			detail: { affectedRevisionCount: 1 },
			expiresAt: '2027-07-30T08:00:00.000Z',
		}],
		// A sweep is not a person, so the reading gives its own spelling back (#398).
		actorNames: { 'graphics-reconciliation-policy': 'graphics-reconciliation-policy' },
	};
}

function trashedInspection(): GraphicsQueueInspectionReading {
	return {
		key: 'trashed-asset:asset-trashed',
		queue: 'trashed-asset',
		severity: 'warning',
		subject: { kind: 'graphic-asset', id: 'asset-trashed' },
		title: 'Old sting',
		authority: {
			expectedReachability: 'catalogue',
			presentBytes: 'byte-store',
			contentAvailabilityFlag: 'advisory-reconciliation-state',
		},
		deadline: '2026-08-29T09:00:00.000Z',
		referenceCount: 0,
		actions: ['restore-graphic-asset', 'purge-now'],
		detail: {
			kind: 'graphic-asset',
			lifecycle: {
				state: 'trashed',
				priorState: 'retired',
				trashedAt: '2026-07-30T09:00:00.000Z',
				recoverableUntil: '2026-08-29T09:00:00.000Z',
			},
			revisions: [],
			usage: [],
		},
		evidence: [],
		actorNames: {},
	};
}

function retiredInspection(): GraphicsQueueInspectionReading {
	return {
		key: 'retired-asset:asset-retired',
		queue: 'retired-asset',
		severity: 'info',
		subject: { kind: 'graphic-asset', id: 'asset-retired' },
		title: 'Season one backdrop',
		authority: {
			expectedReachability: 'catalogue',
			presentBytes: 'byte-store',
			contentAvailabilityFlag: 'advisory-reconciliation-state',
		},
		referenceCount: 1,
		actions: ['restore-graphic-asset'],
		detail: {
			kind: 'graphic-asset',
			lifecycle: { state: 'retired' },
			revisions: [],
			usage: [],
		},
		evidence: [],
		actorNames: {},
	};
}

const passthroughStub = defineComponent({
	template: '<div><slot name="actions" /><slot name="header" /><slot /></div>',
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
	props: ['label', 'disabled'],
	emits: ['click'],
	template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot />{{ label }}</button>',
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

async function mountPage() {
	const { default: QueuesPage } = await import('../../../../../app/pages/admin/graphics-assets/queues.vue');
	return mount(QueuesPage, {
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

/** Enters the administrator token and takes the first reading, as an administrator does. */
async function openQueues() {
	const wrapper = await mountPage();
	const token = wrapper.find('input');
	if (token.exists()) {
		await token.setValue('admin-token');
		await wrapper.findAll('button')
			.find(button => button.text() === 'Open queues')!
			.trigger('click');
	}
	await settle();
	return wrapper;
}

function buttonNamed(wrapper: Awaited<ReturnType<typeof mountPage>>, label: string) {
	return wrapper.findAll('button').find(button => button.text() === label);
}

/** Each surface answers with its own payload, so nothing is proved by a uniform mock. */
function serve(options: {
	queues?: GraphicsOperationalQueuesOverview;
	inspection?: GraphicsQueueInspectionReading;
	action?: unknown;
} = {}) {
	mockApiFetch.mockImplementation((url: string) => {
		if (url === '/api/admin/graphics-assets/queues')
			return Promise.resolve(options.queues ?? overview());
		if (url === '/api/admin/graphics-assets/queues/inspection')
			return Promise.resolve(options.inspection ?? unavailableInspection());
		return Promise.resolve(options.action ?? { outcome: 'completed' });
	});
}

describe('the Graphics Asset Library operational queues page', () => {
	beforeEach(() => {
		mockApiFetch.mockReset();
		mockRouter.replace.mockClear();
		routeQuery.queue = undefined;
		routeQuery.item = undefined;
		serve();
	});

	it('organises work by operational meaning and keeps every state distinct', async () => {
		const wrapper = await openQueues();

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/admin/graphics-assets/queues',
			{ headers: { 'x-graphics-admin-token': 'admin-token' } },
		);

		// Nine queues, nine distinct labels: nothing collapses two states into one.
		const labels = [
			'Critical Integrity Incidents',
			'Unavailable Content',
			'Missing Graphics Derivatives',
			'Retryable ingestion',
			'Expired staged input',
			'Trash awaiting purge',
			'Superseded revisions',
			'Quarantined objects',
			'Retired Graphic Assets',
		];
		const text = wrapper.text();
		for (const label of labels)
			expect(text).toContain(label);
		expect(new Set(labels).size).toBe(labels.length);

		// The queues are listed most severe first, so the order is the work order.
		const positions = labels.map(label => text.indexOf(label));
		expect(positions).toEqual([...positions].sort((first, second) => first - second));

		// Retirement is the one reversible state under no deadline, and says so.
		expect(text).toContain('Reversible, no deadline');
	});

	it('shows the catalogue expectation beside the byte evidence for a selected item', async () => {
		const wrapper = await openQueues();
		await buttonNamed(wrapper, 'Lower third · revision 1')!.trigger('click');
		await settle();

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/admin/graphics-assets/queues/inspection',
			{
				headers: { 'x-graphics-admin-token': 'admin-token' },
				query: { queue: 'unavailable-content', subjectId: 'discrepancy-unavailable' },
			},
		);

		const text = wrapper.text();
		// The two sides are named and never merged into one verdict.
		expect(text).toContain('The catalogue expects');
		expect(text).toContain('The byte store reported');
		expect(text).toContain('4.0 KiB');
		expect(text).toContain('No bytes present');
		expect(text).toContain('canonical-object-missing');

		// Identity, affected pinned usage, and the audit history for this subject.
		expect(text).toContain('discrepancy-unavailable');
		expect(text).toContain('Lower third');
		expect(text).toContain('2 pinned references');
		expect(text).toContain('content-unavailable-detected');
	});

	it('offers exact-byte repair only where it is valid and never offers adoption', async () => {
		const wrapper = await openQueues();

		await buttonNamed(wrapper, 'Lower third · revision 1')!.trigger('click');
		await settle();
		expect(buttonNamed(wrapper, 'Repair with exact bytes')).toBeDefined();
		expect(buttonNamed(wrapper, 'Regenerate derivative')).toBeUndefined();

		// A quarantined object exposes its recheck deadline and nothing that writes.
		serve({
			inspection: {
				...unavailableInspection(),
				key: 'quarantined-object:discrepancy-quarantined',
				queue: 'quarantined-object',
				subject: { kind: 'graphics-discrepancy', id: 'discrepancy-quarantined' },
				title: 'unexpected-canonical-object',
				deadline: '2026-08-06T09:00:00.000Z',
				actions: ['recheck'],
			},
		});
		await buttonNamed(wrapper, 'unexpected-canonical-object')!.trigger('click');
		await settle();

		expect(buttonNamed(wrapper, 'Recheck')).toBeDefined();
		expect(buttonNamed(wrapper, 'Repair with exact bytes')).toBeUndefined();
		expect(buttonNamed(wrapper, 'Regenerate derivative')).toBeUndefined();
		expect(wrapper.text()).not.toContain('Adopt');
	});

	it('keeps the selected item across a reload', async () => {
		const wrapper = await openQueues();
		await buttonNamed(wrapper, 'Lower third · revision 1')!.trigger('click');
		await settle();

		// The selection is held in the address, not in the page.
		expect(mockRouter.replace).toHaveBeenCalledWith({
			query: { queue: 'unavailable-content', item: 'discrepancy-unavailable' },
		});
		wrapper.unmount();

		const returned = await openQueues();
		await settle();
		expect(returned.text()).toContain('The catalogue expects');
		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/admin/graphics-assets/queues/inspection',
			expect.objectContaining({
				query: { queue: 'unavailable-content', subjectId: 'discrepancy-unavailable' },
			}),
		);
	});

	it('reports a recheck that fixed nothing as still needing another run', async () => {
		// Reconciliation answers in its own vocabulary. `unchanged` is what a
		// recheck says when the bytes are still gone, which is the commonest
		// answer on open unavailable content — and the opposite of the subject
		// already being how the administrator wanted it.
		serve({ action: { outcome: 'unchanged' } });
		const wrapper = await openQueues();
		await buttonNamed(wrapper, 'Lower third · revision 1')!.trigger('click');
		await settle();

		await buttonNamed(wrapper, 'Recheck')!.trigger('click');
		await settle();

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/admin/graphics-assets/discrepancies/discrepancy-unavailable/actions',
			expect.objectContaining({ method: 'POST', body: { action: 'recheck' } }),
		);
		expect(wrapper.text()).toContain('Retryable — unavailable');
		expect(wrapper.text()).not.toContain('Already in state');
	});

	it('reports an already-restored asset as already in state', async () => {
		serve({
			inspection: retiredInspection(),
			action: { outcome: 'already-in-state' },
		});
		const wrapper = await openQueues();
		await buttonNamed(wrapper, 'Season one backdrop')!.trigger('click');
		await settle();

		await buttonNamed(wrapper, 'Restore')!.trigger('click');
		await settle();

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/admin/graphics-assets/asset-retired/lifecycle-actions',
			expect.objectContaining({ method: 'POST', body: { action: 'restore' } }),
		);
		expect(wrapper.text()).toContain('Already in state');
	});

	it('will not purge without an explicit typed confirmation', async () => {
		serve({ inspection: trashedInspection() });
		const wrapper = await openQueues();
		await buttonNamed(wrapper, 'Old sting')!.trigger('click');
		await settle();

		// Trash preserves the state restoration returns the asset to.
		expect(wrapper.text()).toContain('Restores to Retired');

		await buttonNamed(wrapper, 'Purge now')!.trigger('click');
		await settle();

		// Nothing has been sent: purge is destructive and asks first.
		expect(mockApiFetch).not.toHaveBeenCalledWith(
			expect.stringContaining('/purge'),
			expect.anything(),
		);
		expect(wrapper.text()).toContain('Type purge-now to confirm');
		expect(buttonNamed(wrapper, 'Confirm early purge')!.attributes('disabled')).toBeDefined();

		const confirmation = wrapper.findAll('input')
			.find(input => input.attributes('placeholder') === 'purge-now')!;
		await confirmation.setValue('purge-now');
		await settle();

		serve({ inspection: trashedInspection(), action: { outcome: 'purged', referenceCount: 0 } });
		await buttonNamed(wrapper, 'Confirm early purge')!.trigger('click');
		await settle();

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/admin/graphics-assets/asset-trashed/purge',
			expect.objectContaining({
				method: 'POST',
				body: { confirmation: 'purge-now' },
			}),
		);
		expect(wrapper.text()).toContain('Completed');
	});

	it('reports a purge the fresh reference proof refused', async () => {
		serve({
			inspection: trashedInspection(),
			action: { outcome: 'in-use', usage: [] },
		});
		const wrapper = await openQueues();
		await buttonNamed(wrapper, 'Old sting')!.trigger('click');
		await settle();

		await buttonNamed(wrapper, 'Purge now')!.trigger('click');
		await settle();
		const confirmation = wrapper.findAll('input')
			.find(input => input.attributes('placeholder') === 'purge-now')!;
		await confirmation.setValue('purge-now');
		await settle();
		await buttonNamed(wrapper, 'Confirm early purge')!.trigger('click');
		await settle();

		expect(wrapper.text()).toContain('Reference blocked');
	});
});
