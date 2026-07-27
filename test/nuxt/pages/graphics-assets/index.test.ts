import type {
	GraphicAssetLibraryItem,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';

const {
	mockApiFetch,
	mockRefresh,
	mockTransferFetch,
} = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
	mockRefresh: vi.fn(),
	mockTransferFetch: vi.fn(),
}));

const completedOperation: GraphicsIngestionOperation = {
	id: 'operation-1' as never,
	idempotencyKey: 'upload-1',
	initiatedBy: 'local-graphics-author',
	name: 'Scoreboard logo',
	defaultEventId: 7,
	declaredByteLength: 68,
	transferredByteLength: 68,
	stage: 'completed',
	report: {
		outcome: 'accepted',
		compatibilityProfile: 'png-v1',
		issues: [],
		facts: {
			kind: 'image',
			canonicalMime: 'image/png',
			byteLength: 68,
			sha256: '431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460',
			width: 1,
			height: 1,
			pixelCount: 1,
			bitDepth: 8,
			colorModel: 'grayscale-alpha',
			hasAlpha: true,
		},
	},
	result: {
		outcome: 'published',
		assetId: 'asset-1' as never,
		revisionId: 'revision-1' as never,
	},
	createdAt: '2026-07-27T04:00:00.000Z',
	updatedAt: '2026-07-27T04:00:01.000Z',
};

const assets = ref<GraphicAssetLibraryItem[]>([{
	id: 'asset-1' as never,
	name: 'Scoreboard logo',
	kind: 'image',
	revisionId: 'revision-1' as never,
	revisionNumber: 1,
	facts: completedOperation.report!.outcome === 'accepted'
		? completedOperation.report!.facts
		: {} as never,
	eventIds: [7],
	operation: completedOperation,
}]);

const eventStore = reactive({ eventId: 7 });

mockNuxtImport('useEventStore', () => () => eventStore);
mockNuxtImport('$fetch', () => mockApiFetch);
mockNuxtImport('useFetch', () => () => ({
	data: assets,
	status: ref('success'),
	error: ref(null),
	refresh: mockRefresh,
}));

const passthroughStub = defineComponent({
	template: '<div><slot name="actions" /><slot name="header" /><slot /><slot name="footer" /></div>',
});
const fileUploadStub = defineComponent({
	props: ['modelValue'],
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="file-upload">Choose PNG</button>',
});
const inputStub = defineComponent({
	props: ['modelValue'],
	emits: ['update:modelValue'],
	template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
});
const buttonStub = defineComponent({
	props: ['label', 'disabled'],
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot />{{ label }}</button>',
});
const badgeStub = defineComponent({
	props: ['label'],
	template: '<span>{{ label }}<slot /></span>',
});

async function mountPage() {
	const { default: LibraryWorkspace } = await import('../../../../app/pages/graphics-assets/index.vue');
	return mount(LibraryWorkspace, {
		global: {
			stubs: {
				NuxtLayout: passthroughStub,
				UAlert: passthroughStub,
				UBadge: badgeStub,
				UButton: buttonStub,
				UCard: passthroughStub,
				UFileUpload: fileUploadStub,
				UFormField: passthroughStub,
				UIcon: passthroughStub,
				UInput: inputStub,
			},
		},
	});
}

describe('the Graphics Asset Library Workspace', () => {
	beforeEach(() => {
		mockApiFetch.mockReset();
		mockRefresh.mockReset();
		mockTransferFetch.mockReset();
		vi.stubGlobal('fetch', mockTransferFetch);
		localStorage.clear();
	});

	it('shows searchable previews, verified facts, Event associations, and exact operation results', async () => {
		const wrapper = await mountPage();

		expect(wrapper.text()).toContain('Graphics Asset Library');
		expect(wrapper.text()).toContain('Scoreboard logo');
		expect(wrapper.text()).toContain('1 × 1');
		expect(wrapper.text()).toContain('image/png');
		expect(wrapper.text()).toContain('Pixels');
		expect(wrapper.text()).toContain('8-bit grayscale-alpha');
		expect(wrapper.text()).toContain('alpha yes');
		expect(wrapper.text()).toContain('Compatibility png-v1');
		expect(wrapper.text()).toContain('431ced6916a2a21a');
		expect(wrapper.text()).toContain('Event 7');
		expect(wrapper.text()).toContain('operation-1');
		expect(wrapper.text()).toContain('revision-1');
		expect(wrapper.text()).toContain('"outcome":"published"');
		expect(wrapper.get('img').attributes('src')).toBe('/api/graphics-assets/asset-1/thumbnail');
	});

	it('initiates an Event-associated operation before transferring the selected PNG', async () => {
		const wrapper = await mountPage();
		const file = new File([new Uint8Array(68)], 'new-scoreboard.png', { type: 'image/png' });
		mockApiFetch.mockResolvedValue({
			...completedOperation,
			stage: 'created',
			report: undefined,
			result: undefined,
			transferredByteLength: 0,
		});
		mockTransferFetch.mockResolvedValue(new Response(JSON.stringify(completedOperation), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		}));

		wrapper.getComponent(fileUploadStub).vm.$emit('update:modelValue', file);
		await flushPromises();
		await wrapper.get('[data-testid="upload-png"]').trigger('click');
		await flushPromises();

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/graphics-assets/ingestion-operations',
			expect.objectContaining({
				method: 'POST',
				body: expect.objectContaining({
					name: 'new-scoreboard.png',
					defaultEventId: 7,
					declaredByteLength: 68,
				}),
			}),
		);
		expect(mockTransferFetch).toHaveBeenCalledWith(
			'/api/graphics-assets/ingestion-operations/operation-1/content',
			expect.objectContaining({
				method: 'PUT',
				body: file,
			}),
		);
		expect(mockRefresh).toHaveBeenCalledOnce();
		expect(wrapper.text()).toContain('Published asset asset-1 revision revision-1');
	});
});
