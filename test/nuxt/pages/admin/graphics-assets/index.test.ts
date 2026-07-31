import type { GraphicsOperationsCockpit } from '~~/shared/types/graphicsAsset';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

mockNuxtImport('$fetch', () => mockApiFetch);

const GIB = 1024 * 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

function completeCockpit(
	overrides: Partial<Extract<GraphicsOperationsCockpit, { outcome: 'complete' }>> = {},
): GraphicsOperationsCockpit {
	return {
		outcome: 'complete',
		checkedAt: '2026-07-30T09:00:00.000Z',
		condition: {
			status: 'degraded',
			catalogue: {
				status: 'degraded',
				reason: {
					code: 'catalogue-records-unavailable-content',
					retryable: true,
					openCount: 2,
				},
			},
			canonicalByteStore: {
				status: 'degraded',
				reason: {
					code: 'canonical-bytes-disagree-with-catalogue',
					retryable: true,
					openCount: 3,
				},
			},
			stagingByteStore: { status: 'healthy' },
		},
		alerts: {
			countsBySeverity: { critical: 1, warning: 1, info: 0 },
			open: [
				{
					code: 'critical-integrity-incident-open',
					severity: 'critical',
					openCount: 1,
					persistent: true,
				},
				{
					code: 'unavailable-content-open',
					severity: 'warning',
					openCount: 2,
					persistent: true,
				},
			],
		},
		capacity: {
			canonical: {
				limitBytes: 100 * GIB,
				usedBytes: 85 * GIB,
				reservedBytes: 0,
				availableBytes: 15 * GIB,
				pressure: 'warning',
				usedFraction: 0.85,
				boundaries: {
					warningFraction: 0.8,
					criticalFraction: 0.95,
					fullFraction: 1,
					warningBytes: 80 * GIB,
					criticalBytes: 95 * GIB,
					fullBytes: 100 * GIB,
				},
				breakdown: {
					retainedSourceBytes: 80 * GIB,
					retainedDerivativeBytes: 5 * GIB,
					metadataBytes: 0,
					providerCacheBytes: 0,
					unreachableQuarantineBytes: 0,
				},
			},
			staging: {
				limitBytes: 10 * GIB,
				usedBytes: 1 * GIB,
				reservedBytes: 0,
				availableBytes: 9 * GIB,
				usedFraction: 0.1,
			},
		},
		ingestion: {
			counts: {
				'input-expired': 1,
				'retryable': 0,
				'awaiting-confirmation': 1,
				'active': 0,
			},
			operations: [
				{
					operationId: 'operation-expired' as never,
					attention: 'input-expired',
					stage: 'created',
					source: 'local-upload',
					initiatedBy: 'author-one',
					name: 'Abandoned upload',
					transferredByteLength: 0,
					declaredByteLength: 2048,
					transferComplete: false,
					stagingBytes: 2048,
					inputExpiresAt: '2026-07-29T09:00:00.000Z',
					updatedAt: '2026-07-28T09:00:00.000Z',
				},
				{
					operationId: 'operation-paused' as never,
					attention: 'awaiting-confirmation',
					stage: 'awaiting-confirmation',
					source: 'remote-copy',
					initiatedBy: 'author-two',
					name: 'Remote copy',
					transferredByteLength: 4096,
					declaredByteLength: 4096,
					transferComplete: true,
					stagingBytes: 4096,
					inputExpiresAt: '2026-08-06T09:00:00.000Z',
					updatedAt: '2026-07-30T08:00:00.000Z',
				},
			],
		},
		reconciliation: {
			authority: {
				expectedReachability: 'catalogue',
				presentBytes: 'byte-store',
				contentAvailabilityFlag: 'advisory-reconciliation-state',
			},
			openCounts: {
				'unavailable-content': 2,
				'missing-derivative': 0,
				'unexpected-object': 0,
				'critical-integrity-incident': 1,
			},
			countsBySeverity: { critical: 1, warning: 2, info: 0 },
			isolatedIncidentCount: 1,
		},
		lifecycle: {
			retired: { count: 4, reversibleWithoutDeadline: true },
			trashed: {
				count: 2,
				nextDeadline: '2026-08-29T00:00:00.000Z',
				guaranteeMilliseconds: 30 * DAY,
			},
			supersededRevisions: {
				count: 6,
				nextDeadline: '2026-10-28T00:00:00.000Z',
				guaranteeMilliseconds: 90 * DAY,
			},
			frozenRevisions: { count: 1 },
			quarantinedContent: { count: 3, guaranteeMilliseconds: 7 * DAY },
			stagedInput: { count: 2, guaranteeMilliseconds: 7 * DAY },
			guaranteesShortenedUnderPressure: false,
		},
		recentOutcomes: {
			consideredEntryCount: 2,
			countsByGroup: {
				'unavailable-content': 1,
				'missing-derivative': 0,
				'quarantined-object': 0,
				'integrity-incident': 1,
				'resolved-repair': 0,
			},
			entries: [
				{
					id: 'evidence-1',
					recordedAt: '2026-07-30T08:30:00.000Z',
					group: 'integrity-incident',
					category: 'critical-integrity-incident',
					subject: { kind: 'graphics-discrepancy', id: 'discrepancy-1' },
					outcome: 'critical-integrity-incident-opened',
					reason: 'canonical-object-digest-mismatch',
				},
			],
		},
		...overrides,
	} as GraphicsOperationsCockpit;
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
	props: ['label'],
	emits: ['click'],
	template: '<button @click="$emit(\'click\')"><slot />{{ label }}</button>',
});
const inputStub = defineComponent({
	props: ['modelValue', 'type'],
	emits: ['update:modelValue'],
	template: `<input
		:value="modelValue"
		:type="type"
		@input="$emit('update:modelValue', $event.target.value)"
	>`,
});

async function mountPage() {
	const { default: CockpitPage } = await import('../../../../../app/pages/admin/graphics-assets/index.vue');
	return mount(CockpitPage, {
		global: {
			stubs: {
				NuxtLayout: passthroughStub,
				UAlert: alertStub,
				UButton: buttonStub,
				UCard: passthroughStub,
				UBadge: badgeStub,
				UIcon: passthroughStub,
				UFormField: passthroughStub,
				UInput: inputStub,
			},
		},
	});
}

/** Enters the administrator token and takes the first reading, as an administrator does. */
async function openCockpit() {
	const wrapper = await mountPage();
	await wrapper.find('input').setValue('admin-token');
	await wrapper.findAll('button')
		.find(button => button.text() === 'Open cockpit')!
		.trigger('click');
	await nextTick();
	return wrapper;
}

/**
 * The server answers each surface with its own payload, so the page is never
 * accidentally proved correct by a mock that returns the same body everywhere.
 */
function serve(reading: GraphicsOperationsCockpit, sweep?: unknown) {
	mockApiFetch.mockImplementation((url: string) =>
		url === '/api/admin/graphics-assets/operations-cockpit'
			? Promise.resolve(reading)
			: Promise.resolve(sweep ?? {}));
}

describe('the Graphics Asset Library Operations cockpit page', () => {
	beforeEach(() => {
		mockApiFetch.mockReset();
		serve(completeCockpit());
	});

	it('answers whether the library is safe, with catalogue and byte health kept separate', async () => {
		const wrapper = await openCockpit();

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/admin/graphics-assets/operations-cockpit',
			{ headers: { 'x-graphics-admin-token': 'admin-token' } },
		);

		expect(wrapper.text()).toContain('D1 catalogue');
		expect(wrapper.text()).toContain('Canonical byte store');
		expect(wrapper.text()).toContain('Staging byte store');
		expect(wrapper.text()).toContain('Degraded');
		expect(wrapper.text()).toContain('Healthy');

		// Each side is degraded on its own evidence, and says which.
		expect(wrapper.text())
			.toContain('recording 2 Graphic Asset Contents it cannot currently serve');
		expect(wrapper.text()).toContain('disagreeing with the catalogue on 3 subjects');
	});

	it('shows every quota boundary and keeps staging a separate budget', async () => {
		const wrapper = await openCockpit();

		expect(wrapper.text()).toContain('Warning at 80%');
		expect(wrapper.text()).toContain('Critical at 95%');
		expect(wrapper.text()).toContain('Blocked at 100%');
		expect(wrapper.text()).toContain('80.0 GiB');
		expect(wrapper.text()).toContain('95.0 GiB');

		expect(wrapper.text()).toContain('Graphics Staging Allowance');
		expect(wrapper.text())
			.toContain('never borrowed from or lent to the Canonical Graphics Quota');
	});

	it('shows each unfinished ingestion with the exact facts of its current stage', async () => {
		const wrapper = await openCockpit();

		expect(wrapper.text()).toContain('Input expired: 1');
		expect(wrapper.text()).toContain('Awaiting confirmation: 1');
		expect(wrapper.text()).toContain('Abandoned upload');
		expect(wrapper.text()).toContain('stage created');
		expect(wrapper.text()).toContain('(in progress)');
		expect(wrapper.text()).toContain('Remote copy');
		expect(wrapper.text()).toContain('stage awaiting-confirmation');
		expect(wrapper.text()).toContain('(complete)');
		expect(wrapper.text()).toContain('Staged input expires');
	});

	it('states every lifecycle deadline and never offers to shorten one', async () => {
		const wrapper = await openCockpit();

		expect(wrapper.text()).toContain('reversible, no deadline');
		expect(wrapper.text()).toContain('30 days');
		expect(wrapper.text()).toContain('90 days');
		expect(wrapper.text()).toContain('Storage pressure never shortens any of these guarantees.');

		// No action on the page proposes trading a guarantee for capacity.
		const actions = wrapper.findAll('button').map(button => button.text());
		expect(actions).toEqual(expect.arrayContaining([
			'Refresh',
			'Run reconciliation now',
			'Run retention sweep now',
		]));
		expect(actions.join(' ')).not.toContain('Shorten');
		expect(actions.join(' ')).not.toContain('Purge');
	});

	it('keeps a critical incident visible after navigating away and back', async () => {
		const wrapper = await openCockpit();
		expect(wrapper.text()).toContain('Critical integrity incidents are open and fail closed');
		expect(wrapper.text()).toContain('Persistent');

		// Leaving the page discards nothing that matters: the incident is durable
		// catalogue state, so returning reads exactly the same alert back.
		wrapper.unmount();
		const returned = await openCockpit();

		expect(returned.text()).toContain('Critical integrity incidents are open and fail closed');
		expect(returned.text()).toContain('1 critical');
	});

	it('re-reads durable state after running a sweep', async () => {
		serve(completeCockpit(), {
			correlationId: 'sweep-1',
			startedAt: '2026-07-30T09:00:00.000Z',
			completedAt: '2026-07-30T09:00:05.000Z',
			content: { checked: 12, unavailableDetected: 1, availabilityRestored: 0 },
			derivatives: { missingDetected: 0 },
			unexpectedObjects: { scanned: 0, quarantined: 0 },
			criticalIntegrityIncidents: 0,
			workingCopies: { reclaimed: 0 },
			evidence: { recorded: 1 },
		});
		const wrapper = await openCockpit();
		mockApiFetch.mockClear();

		await wrapper.findAll('button')
			.find(button => button.text() === 'Run reconciliation now')!
			.trigger('click');
		await nextTick();

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/admin/graphics-assets/reconciliation',
			{ method: 'POST', headers: { 'x-graphics-admin-token': 'admin-token' } },
		);
		// The reading is taken again from the server rather than patched locally.
		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/admin/graphics-assets/operations-cockpit',
			{ headers: { 'x-graphics-admin-token': 'admin-token' } },
		);
	});

	it('still answers the safety question when the catalogue cannot answer', async () => {
		serve({
			outcome: 'catalogue-unavailable',
			checkedAt: '2026-07-30T09:00:00.000Z',
			condition: {
				status: 'unavailable',
				catalogue: {
					status: 'unavailable',
					reason: { code: 'catalogue-unavailable', retryable: true },
				},
				canonicalByteStore: { status: 'healthy' },
				stagingByteStore: { status: 'healthy' },
			},
			alerts: {
				countsBySeverity: { critical: 1, warning: 0, info: 0 },
				open: [{
					code: 'catalogue-unavailable',
					severity: 'critical',
					openCount: 1,
					persistent: false,
				}],
			},
		});

		const wrapper = await openCockpit();

		expect(wrapper.text()).toContain('Unavailable');
		expect(wrapper.text()).toContain('The D1 catalogue cannot answer');
		expect(wrapper.text()).toContain('Catalogue state is unavailable');
		expect(wrapper.text()).toContain('This is retryable.');
		// Nothing derived from the catalogue is invented in its absence.
		expect(wrapper.text()).not.toContain('Canonical Graphics Quota');
	});
});
