import type {
	BroadcastGraphicsLiveState,
	BroadcastGraphicsRecoveryFault,
} from '~~/shared/modules/broadcast-graphics-live-session';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicAssetReferenceStatus } from '~~/shared/types/graphicsAsset';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import {
	broadcastGraphicPlayoutState,
	createInitialBroadcastGraphicsLiveState,
	graphicInputTraces,
	onAirBroadcastGraphicIds,
} from '~~/shared/modules/broadcast-graphics-live-session';

enableAutoUnmount(afterEach);

const mockLiveState = ref<BroadcastGraphicsLiveState>(createInitialBroadcastGraphicsLiveState());
const mockLoadSession = vi.fn();
const mockTake = vi.fn();
const mockOut = vi.fn();
const mockPendingGraphicIds = ref<string[]>([]);
const mockError = ref<string | null>(null);
const mockRecoveryFault = ref<BroadcastGraphicsRecoveryFault | null>(null);
const mockResetLiveState = vi.fn();

/** What the realtime transport reports; the workspace derives disconnection from it. */
const mockConnectionState = ref<'connected' | 'disconnected' | 'suspended' | 'connecting'>('connected');

mockNuxtImport('tryUseRealtime', () => () => ({
	get connectionState() {
		return mockConnectionState.value;
	},
	get isConnected() {
		return mockConnectionState.value === 'connected';
	},
}));

/** Answers the reset confirmation; `null` stands for the operator cancelling. */
const mockConfirmResult = ref<boolean>(true);
const mockConfirmOpen = vi.fn();

mockNuxtImport('useOverlay', () => () => ({
	create: () => ({
		open: (...args: unknown[]) => {
			mockConfirmOpen(...args);
			return { result: Promise.resolve(mockConfirmResult.value) };
		},
	}),
}));

mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => ({
	loadSession: mockLoadSession,
	take: mockTake,
	out: mockOut,
	get error() {
		return mockError.value;
	},
	isPending: (_screenId: number, graphicId: string) => mockPendingGraphicIds.value.includes(graphicId),
	playoutState: (_screenId: number, graphicId: string) =>
		broadcastGraphicPlayoutState(mockLiveState.value, graphicId),
	onAirGraphicIds: (_screenId: number, graphics: readonly { id: string }[]) =>
		onAirBroadcastGraphicIds(mockLiveState.value, graphics),
	inputTraces: (_screenId: number, graphic: BroadcastGraphicConfig) =>
		graphicInputTraces(mockLiveState.value, graphic.id, graphic),
	setInput: vi.fn(),
	updateGraphic: vi.fn(),
	resetLiveState: mockResetLiveState,
	recoveryFault: () => mockRecoveryFault.value,
}));

/** What every Graphic Asset Revision status request answers with. */
const mockReferenceStatus = ref<GraphicAssetReferenceStatus>({
	outcome: 'available',
	lifecycleState: 'active',
	kind: 'image',
});
/** What the Screen Output Asset Capability endpoint issues, if anything. */
const mockCapabilityResponse = ref<string | null>('program-capability');
const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

mockNuxtImport('$fetch', () => mockApiFetch);

const UAlertStub = defineComponent({
	props: { title: { type: String, required: false }, description: { type: String, required: false } },
	template: '<div><strong>{{ title }}</strong><span>{{ description }}</span></div>',
});

const ScreenSettingsCardStub = defineComponent({
	props: { title: { type: String, required: false } },
	template: '<section><h2>{{ title }}</h2><slot /></section>',
});

const UIEmptyStateStub = defineComponent({
	props: { title: { type: String, required: false } },
	template: '<div data-testid="empty-state">{{ title }}</div>',
});

const UBadgeStub = defineComponent({ template: '<span><slot /></span>' });
const UIconStub = defineComponent({ template: '<i />' });
const UFieldGroupStub = defineComponent({ template: '<div><slot /></div>' });
const UButtonStub = defineComponent({
	name: 'UButton',
	props: { disabled: { type: Boolean, default: false } },
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

const lowerThird: BroadcastGraphicConfig = { id: 'lower-third', name: 'Lower Third', items: [] };
const slate: BroadcastGraphicConfig = { id: 'slate', name: 'Slate', items: [] };

async function mountComponent(
	graphics: BroadcastGraphicConfig[] = [lowerThird, slate],
	selectedGraphicId: string | null = null,
) {
	const componentPath = '../../../../../../../app/components/Screen/Modes/BroadcastGraphics/LiveWorkspace.vue';
	const { default: LiveWorkspace } = await import(componentPath);

	const wrapper = mount(LiveWorkspace, {
		props: {
			eventId: 7,
			screen: { id: 3, slug: 'main' } as Screen,
			graphics,
			selectedGraphicId,
			canvasWidth: 1920,
			canvasHeight: 1080,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				UIEmptyState: UIEmptyStateStub,
				UBadge: UBadgeStub,
				UIcon: UIconStub,
				UFieldGroup: UFieldGroupStub,
				UButton: UButtonStub,
				UAlert: UAlertStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

function entryFor(wrapper: Awaited<ReturnType<typeof mountComponent>>, graphicId: string) {
	return wrapper.get(`[data-playout-entry="${graphicId}"]`);
}

describe('broadcastGraphicsLiveWorkspace', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLiveState.value = createInitialBroadcastGraphicsLiveState();
		mockPendingGraphicIds.value = [];
		mockError.value = null;
		mockRecoveryFault.value = null;
		mockConnectionState.value = 'connected';
		mockConfirmResult.value = true;
		mockReferenceStatus.value = { outcome: 'available', lifecycleState: 'active', kind: 'image' };
		mockCapabilityResponse.value = 'program-capability';
		mockApiFetch.mockImplementation(async (path: string) => {
			if (String(path).endsWith('/asset-capability')) {
				if (!mockCapabilityResponse.value)
					throw new Error('no capability');
				return { assetCapability: mockCapabilityResponse.value };
			}
			return mockReferenceStatus.value;
		});
	});

	it('loads the authoritative playout snapshot for the Screen', async () => {
		await mountComponent();

		expect(mockLoadSession).toHaveBeenCalledWith(7, 3);
	});

	it('lists every placed Broadcast Graphic with its Graphic Playout State', async () => {
		mockLiveState.value = { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} };

		const wrapper = await mountComponent();

		expect(entryFor(wrapper, 'lower-third').attributes('data-playout-state')).toBe('off');
		expect(entryFor(wrapper, 'slate').attributes('data-playout-state')).toBe('on-air');
	});

	it('takes a Broadcast Graphic on air', async () => {
		const wrapper = await mountComponent();

		await entryFor(wrapper, 'slate').get('[data-testid="playout-take"]').trigger('click');

		expect(mockTake).toHaveBeenCalledWith(7, 3, 'slate', false);
	});

	it('takes a Broadcast Graphic off air', async () => {
		mockLiveState.value = { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} };
		const wrapper = await mountComponent();

		await entryFor(wrapper, 'slate').get('[data-testid="playout-out"]').trigger('click');

		expect(mockOut).toHaveBeenCalledWith(7, 3, 'slate', false);
	});

	it('offers Cut variants of both actions', async () => {
		const wrapper = await mountComponent();

		await entryFor(wrapper, 'slate').get('[data-testid="playout-cut-take"]').trigger('click');
		await entryFor(wrapper, 'slate').get('[data-testid="playout-cut-out"]').trigger('click');

		expect(mockTake).toHaveBeenCalledWith(7, 3, 'slate', true);
		expect(mockOut).toHaveBeenCalledWith(7, 3, 'slate', true);
	});

	it('keeps both actions available so a repeat converges on the operator’s latest intent', async () => {
		mockLiveState.value = { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} };
		const wrapper = await mountComponent();
		const entry = entryFor(wrapper, 'slate');

		expect(entry.get('[data-testid="playout-take"]').attributes('disabled')).toBeUndefined();
		expect(entry.get('[data-testid="playout-out"]').attributes('disabled')).toBeUndefined();
	});

	it('reports how many Broadcast Graphics are on air', async () => {
		mockLiveState.value = { playout: { 'slate': { onAir: true, effectiveStartedAt: 0, cut: false }, 'lower-third': { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} };

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="on-air-count"]').text()).toContain('2');
	});

	it('shows an empty stack rather than playout controls when nothing is placed', async () => {
		const wrapper = await mountComponent([]);

		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('No Broadcast Graphics');
		expect(wrapper.find('[data-playout-entry]').exists()).toBe(false);
	});

	it('disables a Broadcast Graphic’s own actions while its action is in flight, and no others', async () => {
		mockPendingGraphicIds.value = ['slate'];

		const wrapper = await mountComponent();

		const slate = entryFor(wrapper, 'slate');
		expect(slate.get('[data-testid="playout-take"]').attributes('disabled')).toBeDefined();
		expect(slate.get('[data-testid="playout-out"]').attributes('disabled')).toBeDefined();
		expect(slate.get('[data-testid="playout-cut-take"]').attributes('disabled')).toBeDefined();
		expect(entryFor(wrapper, 'lower-third').get('[data-testid="playout-take"]').attributes('disabled')).toBeUndefined();
	});

	it('surfaces a failed playout action instead of failing silently on air', async () => {
		mockError.value = 'Broadcast graphics live session has ended';

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="playout-error"]').text()).toContain('live session has ended');
	});

	it('shows no error banner while playout is healthy', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="playout-error"]').exists()).toBe(false);
	});

	it('selects a Broadcast Graphic without changing what is on air', async () => {
		const wrapper = await mountComponent();

		await entryFor(wrapper, 'slate').get('[data-testid="playout-select"]').trigger('click');

		expect(wrapper.emitted('select')).toEqual([['slate']]);
		expect(mockTake).not.toHaveBeenCalled();
	});

	it('generates Live Control for the Broadcast Graphic the operator selected, and for none until they do', async () => {
		const unselected = await mountComponent();
		expect(unselected.find('[data-testid="live-control"]').exists()).toBe(false);
		expect(unselected.text()).not.toContain('Live Control');

		const selected = await mountComponent([lowerThird, slate], 'slate');
		expect(selected.text()).toContain('Live Control');
	});

	it('gives the Program monitor a capability, so it can resolve media at all', async () => {
		// The monitor is a real Screen Output, not a preview: without a capability in
		// its URL it renders every graphic except its media, silently.
		const wrapper = await mountComponent();

		const src = wrapper.get('[data-testid="program-monitor"]').attributes('src')!;
		expect(src).toContain('output=overlay');
		expect(src).toContain(`#asset-capability=${encodeURIComponent('program-capability')}`);
	});

	it('leaves the capability out of the monitor URL until one is issued', async () => {
		// Never a placeholder or a guess: an absent capability resolves no media, which
		// is the property the capability exists to guarantee.
		mockCapabilityResponse.value = null;

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="program-monitor"]').attributes('src')).not.toContain('asset-capability');
	});

	describe('graphic asset references', () => {
		const withMedia: BroadcastGraphicConfig = {
			id: 'slate',
			name: 'Slate',
			items: [{
				type: 'media',
				id: 'logo',
				label: 'Sponsor',
				visible: true,
				anchor: 'top-left',
				x: 0,
				y: 0,
				width: 100,
				height: 100,
				asset: { assetId: 'asset-1' as never, revisionId: 'revision-1' as never },
				mediaKind: 'image',
				fit: 'cover',
				focalPosition: { horizontal: 0.5, vertical: 0.5 },
				opacity: 1,
				playbackRate: 1,
				loop: true,
			}],
		};

		it('blocks Take on a Broadcast Graphic whose Graphic Asset Reference is missing, and says which item', async () => {
			mockReferenceStatus.value = { outcome: 'missing' };

			const wrapper = await mountComponent([lowerThird, withMedia]);

			const entry = entryFor(wrapper, 'slate');
			expect(entry.get('[data-testid="playout-take"]').attributes('disabled')).toBeDefined();
			expect(entry.get('[data-testid="playout-cut-take"]').attributes('disabled')).toBeDefined();
			// Named by the Graphic Item's authored label, which is what an operator can
			// find on the canvas — not by the internal owner slot.
			expect(wrapper.get('[data-testid="playout-asset-blocked-slate"]').text())
				.toContain('Sponsor');
			// Only the owning graphic is invalidated; the rest of the stack still operates.
			expect(entryFor(wrapper, 'lower-third').get('[data-testid="playout-take"]').attributes('disabled'))
				.toBeUndefined();
		});

		it('keeps Out available on an invalidated Broadcast Graphic, so it can leave air', async () => {
			mockReferenceStatus.value = { outcome: 'missing' };
			mockLiveState.value = { playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: false } }, inputs: {} };

			const wrapper = await mountComponent([lowerThird, withMedia]);

			const entry = entryFor(wrapper, 'slate');
			expect(entry.get('[data-testid="playout-out"]').attributes('disabled')).toBeUndefined();

			await entry.get('[data-testid="playout-out"]').trigger('click');
			expect(mockOut).toHaveBeenCalledWith(7, 3, 'slate', false);
		});

		it('offers a retry for Unavailable Graphic Asset Content, and none for a missing reference', async () => {
			// Unavailable is retryable because the revision still exists; missing is an
			// integrity failure that only a repair in the Edit workspace resolves.
			mockReferenceStatus.value = { outcome: 'unavailable', retryable: true };
			const unavailable = await mountComponent([withMedia]);

			expect(unavailable.get('[data-testid="playout-asset-blocked-slate"]').text()).toContain('Retry');
			expect(unavailable.find('[data-testid="playout-retry-asset-content"]').exists()).toBe(true);

			mockReferenceStatus.value = { outcome: 'missing' };
			const missing = await mountComponent([withMedia]);

			expect(missing.find('[data-testid="playout-retry-asset-content"]').exists()).toBe(false);
		});

		it('leaves every action available when each pinned revision resolves', async () => {
			mockReferenceStatus.value = { outcome: 'available', lifecycleState: 'active', kind: 'image' };

			const wrapper = await mountComponent([withMedia]);

			expect(wrapper.find('[data-testid="playout-asset-blocked-slate"]').exists()).toBe(false);
			expect(entryFor(wrapper, 'slate').get('[data-testid="playout-take"]').attributes('disabled'))
				.toBeUndefined();
		});

		it('keeps a known-broken graphic blocked while a re-check is in flight', async () => {
			// Any edit anywhere in the stack re-runs the check. Falling back to a
			// not-yet-known state would re-enable Take on a graphic already known to be
			// broken — every time somebody touched an unrelated graphic.
			mockReferenceStatus.value = { outcome: 'missing' };
			const wrapper = await mountComponent([lowerThird, withMedia]);
			expect(entryFor(wrapper, 'slate').get('[data-testid="playout-take"]').attributes('disabled'))
				.toBeDefined();

			// A new stack array with the same pinned revision, as an unrelated edit yields.
			await wrapper.setProps({
				graphics: [{ ...lowerThird, name: 'Renamed' }, { ...withMedia }],
			});

			expect(entryFor(wrapper, 'slate').get('[data-testid="playout-take"]').attributes('disabled'))
				.toBeDefined();
			expect(wrapper.find('[data-testid="playout-asset-blocked-slate"]').exists()).toBe(true);
		});

		it('never asks about a Broadcast Graphic that pins no assets at all', async () => {
			const wrapper = await mountComponent([lowerThird]);

			// The monitor still asks for its capability; what must not happen is a
			// revision-status request for a graphic that pins nothing.
			const statusRequests = mockApiFetch.mock.calls
				.map(([path]) => String(path))
				.filter(path => path.includes('/revisions/'));
			expect(statusRequests).toEqual([]);
			expect(entryFor(wrapper, 'lower-third').get('[data-testid="playout-take"]').attributes('disabled'))
				.toBeUndefined();
		});
	});
	describe('a disconnected Live Control', () => {
		it('says so, rather than looking like a Live Control that is up to date', async () => {
			mockConnectionState.value = 'disconnected';

			const wrapper = await mountComponent();

			expect(wrapper.get('[data-testid="playout-disconnected"]').text()).toContain('Disconnected');
		});

		it('withholds every playout action, so nothing is formed offline to be replayed later', async () => {
			mockConnectionState.value = 'disconnected';

			const wrapper = await mountComponent();

			const entry = entryFor(wrapper, 'slate');
			for (const action of ['playout-take', 'playout-cut-take', 'playout-out', 'playout-cut-out'])
				expect(entry.get(`[data-testid="${action}"]`).attributes('disabled')).toBeDefined();
		});

		it('queues nothing: a click while disconnected sends no command then and none on reconnection', async () => {
			mockConnectionState.value = 'disconnected';
			const wrapper = await mountComponent();

			await entryFor(wrapper, 'slate').get('[data-testid="playout-take"]').trigger('click');
			expect(mockTake).not.toHaveBeenCalled();

			mockConnectionState.value = 'connected';
			await flushPromises();

			// A playout intent states what should be on air *now*. Replaying one formed
			// during an outage would put a graphic on program the operator decided about
			// minutes ago and has since watched not happen.
			expect(mockTake).not.toHaveBeenCalled();
		});

		it('reloads the authoritative snapshot on reconnection, because nothing arrives late', async () => {
			mockConnectionState.value = 'disconnected';
			await mountComponent();
			mockLoadSession.mockClear();

			mockConnectionState.value = 'connected';
			await flushPromises();

			expect(mockLoadSession).toHaveBeenCalledWith(7, 3);
		});

		it('holds its last known state rather than blanking the stack', async () => {
			// Live Control shows the same thing a disconnected output shows: what was last
			// accepted. A dropped websocket is not news about what is on air.
			mockLiveState.value = { playout: { slate: { onAir: true } }, inputs: {} };
			const wrapper = await mountComponent();

			mockConnectionState.value = 'disconnected';
			await flushPromises();

			expect(entryFor(wrapper, 'slate').attributes('data-playout-state')).toBe('on-air');
		});

		it('shows no disconnection while the first connection is still being made', async () => {
			mockConnectionState.value = 'connecting';

			const wrapper = await mountComponent();

			expect(wrapper.find('[data-testid="playout-disconnected"]').exists()).toBe(false);
		});
	});

	describe('durable live state that could not be recovered', () => {
		it('states the fault prominently and says what puts a graphic back on air', async () => {
			mockRecoveryFault.value = { reason: 'corrupt', detail: 'the playout record for slate is not a record' };

			const wrapper = await mountComponent();

			const fault = wrapper.get('[data-testid="playout-recovery-fault"]');
			expect(fault.text()).toContain('the playout record for slate is not a record');
			expect(fault.text()).toMatch(/transparent/i);
			// The recovery action, named: an operator will not guess that a Take is what
			// clears this.
			expect(fault.text()).toMatch(/Take/);
		});

		it('leaves Take available, because Take is the recovery', async () => {
			mockRecoveryFault.value = { reason: 'missing', detail: 'no durable live state' };

			const wrapper = await mountComponent();

			expect(entryFor(wrapper, 'slate').get('[data-testid="playout-take"]').attributes('disabled'))
				.toBeUndefined();
		});

		it('shows no fault while live state reads normally', async () => {
			const wrapper = await mountComponent();

			expect(wrapper.find('[data-testid="playout-recovery-fault"]').exists()).toBe(false);
		});
	});

	describe('resetting live state', () => {
		it('resets only after the operator confirms', async () => {
			const wrapper = await mountComponent();

			await wrapper.get('[data-testid="playout-reset-live-state"]').trigger('click');
			await flushPromises();

			expect(mockResetLiveState).toHaveBeenCalledWith(7, 3);
		});

		it('does nothing when the operator cancels', async () => {
			mockConfirmResult.value = false;
			const wrapper = await mountComponent();

			await wrapper.get('[data-testid="playout-reset-live-state"]').trigger('click');
			await flushPromises();

			expect(mockResetLiveState).not.toHaveBeenCalled();
		});

		it('warns that prepared Graphic Input values go with it', async () => {
			// The one action that discards staged work, so the confirmation has to say so
			// — a mode change deliberately preserves it, and an operator will expect the
			// same here unless told otherwise.
			const wrapper = await mountComponent();

			await wrapper.get('[data-testid="playout-reset-live-state"]').trigger('click');
			await flushPromises();

			expect(mockConfirmOpen).toHaveBeenCalledWith(expect.objectContaining({
				description: expect.stringMatching(/Graphic Input values are discarded/),
			}));
		});
	});
});
