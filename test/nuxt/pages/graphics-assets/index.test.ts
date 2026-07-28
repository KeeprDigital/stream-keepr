import type {
	GraphicAsset,
	GraphicsAssetLibraryCapacity,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';

const {
	mockApiFetch,
	mockBrowserDecode,
	mockCapacityRefresh,
	mockRefresh,
	mockTransferFetch,
} = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
	mockBrowserDecode: vi.fn(),
	mockCapacityRefresh: vi.fn(),
	mockRefresh: vi.fn(),
	mockTransferFetch: vi.fn(),
}));

vi.mock('../../../../app/utils/verifyStillImageBrowserDecode', () => ({
	verifyStillImageBrowserDecode: mockBrowserDecode,
}));

const completedOperation: GraphicsIngestionOperation = {
	id: 'operation-1' as never,
	idempotencyKey: 'upload-1',
	initiatedBy: 'local-graphics-author',
	name: 'Scoreboard logo',
	defaultEventId: 7,
	duplicateContentPolicy: 'reuse',
	declaredByteLength: 68,
	transferredByteLength: 68,
	stage: 'completed',
	report: {
		outcome: 'accepted',
		compatibilityProfile: 'still-image-v1',
		issues: [],
		facts: {
			kind: 'image',
			format: 'png',
			canonicalMime: 'image/png',
			byteLength: 68,
			sha256: '431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460',
			width: 1,
			height: 1,
			pixelCount: 1,
			frameCount: 1,
			bitDepth: 8,
			colorSpace: 'srgb',
			colorModel: 'grayscale-alpha',
			hasAlpha: true,
			orientation: 'normal',
			browserDecodable: true,
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
const jpegPixel = Uint8Array.from(Buffer.from(
	'/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJtAEx7/2Q==',
	'base64',
));
const completedJpegOperation: GraphicsIngestionOperation = {
	...completedOperation,
	declaredByteLength: jpegPixel.byteLength,
	transferredByteLength: jpegPixel.byteLength,
	report: {
		outcome: 'accepted',
		compatibilityProfile: 'still-image-v1',
		issues: [],
		facts: {
			kind: 'image',
			format: 'jpeg',
			canonicalMime: 'image/jpeg',
			byteLength: jpegPixel.byteLength,
			sha256: '58a79b9921ff2dc8485bf82af9974e6e5f589000884ff9a1d3c5a82488032d05',
			width: 1,
			height: 1,
			pixelCount: 1,
			frameCount: 1,
			bitDepth: 8,
			colorSpace: 'srgb',
			colorModel: 'rgb',
			hasAlpha: false,
			orientation: 'normal',
			browserDecodable: true,
		},
	},
};

const assets = ref<GraphicAsset[]>([{
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
const capacity = ref<GraphicsAssetLibraryCapacity>({
	canonical: {
		limitBytes: 100,
		usedBytes: 95,
		reservedBytes: 0,
		availableBytes: 5,
		pressure: 'critical',
		breakdown: {
			retainedSourceBytes: 68,
			retainedDerivativeBytes: 27,
			metadataBytes: 0,
			providerCacheBytes: 0,
			unreachableQuarantineBytes: 0,
		},
	},
	staging: {
		limitBytes: 20,
		usedBytes: 10,
		reservedBytes: 0,
		availableBytes: 10,
	},
});

const eventStore = reactive({ eventId: 7 });

mockNuxtImport('useEventStore', () => () => eventStore);
mockNuxtImport('$fetch', () => mockApiFetch);
mockNuxtImport('useFetch', () => (path: string) => ({
	data: path === '/api/graphics-assets/capacity' ? capacity : assets,
	status: ref('success'),
	error: ref(null),
	refresh: path === '/api/graphics-assets/capacity' ? mockCapacityRefresh : mockRefresh,
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
		mockBrowserDecode.mockReset();
		mockBrowserDecode.mockResolvedValue({
			outcome: 'decoded',
			sourceDigest: '431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460',
			width: 1,
			height: 1,
		});
		mockCapacityRefresh.mockReset();
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
		expect(wrapper.text()).toContain('Compatibility still-image-v1');
		expect(wrapper.text()).toContain('431ced6916a2a21a');
		expect(wrapper.text()).toContain('Event 7');
		expect(wrapper.text()).toContain('operation-1');
		expect(wrapper.text()).toContain('revision-1');
		expect(wrapper.text()).toContain('"outcome":"published"');
		expect(wrapper.get('img').attributes('src')).toBe('/api/graphics-assets/asset-1/thumbnail');
	});

	it('shows canonical and staging usage with critical storage pressure', async () => {
		const wrapper = await mountPage();

		expect(wrapper.text()).toContain('Canonical Capacity Pressure: critical');
		expect(wrapper.text()).toContain('95 B of 100 B');
		expect(wrapper.text()).toContain('Staging 10 B of 20 B');
		expect(wrapper.text()).toContain('Source content 68 B');
		expect(wrapper.text()).toContain('Derivatives 27 B');
	});

	it('browser-decodes the exact source before initiating and publishing it', async () => {
		const wrapper = await mountPage();
		const file = new File([jpegPixel], 'new-scoreboard.jpg', { type: 'image/jpeg' });
		mockBrowserDecode.mockResolvedValueOnce({
			outcome: 'decoded',
			sourceDigest: '58a79b9921ff2dc8485bf82af9974e6e5f589000884ff9a1d3c5a82488032d05',
			width: 1,
			height: 1,
		});
		mockApiFetch.mockResolvedValue({
			...completedJpegOperation,
			stage: 'created',
			report: undefined,
			result: undefined,
			transferredByteLength: 0,
		});
		mockTransferFetch.mockResolvedValueOnce(new Response(JSON.stringify(completedJpegOperation), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		}));

		wrapper.getComponent(fileUploadStub).vm.$emit('update:modelValue', file);
		await flushPromises();
		await wrapper.get('[data-testid="upload-image"]').trigger('click');
		await flushPromises();

		expect(mockBrowserDecode).toHaveBeenCalledWith(expect.any(Blob));
		const browserSource = mockBrowserDecode.mock.calls[0]![0] as Blob;
		expect(browserSource.type).toBe('image/jpeg');
		expect(new Uint8Array(await browserSource.arrayBuffer())).toEqual(jpegPixel);
		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/graphics-assets/ingestion-operations',
			expect.objectContaining({
				method: 'POST',
				body: expect.objectContaining({
					name: 'new-scoreboard.jpg',
					defaultEventId: 7,
					duplicateContentPolicy: 'reuse',
					declaredByteLength: jpegPixel.byteLength,
					sourceFileName: 'new-scoreboard.jpg',
					declaredMime: 'image/jpeg',
					browserDecodeEvidence: {
						outcome: 'decoded',
						sourceDigest: '58a79b9921ff2dc8485bf82af9974e6e5f589000884ff9a1d3c5a82488032d05',
						width: 1,
						height: 1,
					},
				}),
			}),
		);
		expect(mockTransferFetch).toHaveBeenCalledWith(
			'/api/graphics-assets/ingestion-operations/operation-1/content',
			expect.objectContaining({
				method: 'PUT',
				headers: { 'content-type': 'image/jpeg' },
				body: file,
			}),
		);
		expect(mockRefresh).toHaveBeenCalledOnce();
		expect(wrapper.text()).toContain('Published asset asset-1 revision revision-1');
		expect(wrapper.text()).toContain('Exact source browser decode verified before publication.');
	});

	it('preserves the server validation report when malformed input cannot be accepted', async () => {
		const wrapper = await mountPage();
		const malformed = new File([new TextEncoder().encode('not a jpeg')], 'malformed.jpg', {
			type: 'image/jpeg',
		});
		mockBrowserDecode.mockResolvedValueOnce({
			outcome: 'rejected',
			sourceDigest: '084f9658ef9396784017d8d1cb524f494d6009971b3f47d9bd63c01bd5762456',
		});
		const created = {
			...completedOperation,
			declaredByteLength: malformed.size,
			transferredByteLength: 0,
			stage: 'created' as const,
			report: undefined,
			result: undefined,
		};
		const failed: GraphicsIngestionOperation = {
			...created,
			transferredByteLength: malformed.size,
			stage: 'failed',
			report: {
				outcome: 'rejected',
				compatibilityProfile: 'still-image-v1',
				issues: [{
					severity: 'error',
					code: 'unsupported-image-format',
					message: 'Source bytes are not a supported image.',
				}],
			},
			failure: {
				code: 'validation-failed',
				retryable: false,
				message: 'Image did not satisfy the compatibility profile.',
			},
		};
		mockApiFetch.mockResolvedValue(created);
		mockTransferFetch.mockResolvedValue(new Response(JSON.stringify(failed), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		}));

		wrapper.getComponent(fileUploadStub).vm.$emit('update:modelValue', malformed);
		await flushPromises();
		await wrapper.get('[data-testid="upload-image"]').trigger('click');
		await flushPromises();

		expect(mockBrowserDecode).toHaveBeenCalledWith(expect.any(Blob));
		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/graphics-assets/ingestion-operations',
			expect.objectContaining({
				body: expect.objectContaining({
					browserDecodeEvidence: expect.objectContaining({
						outcome: 'rejected',
						sourceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
					}),
				}),
			}),
		);
		expect(wrapper.text()).toContain('unsupported-image-format');
		expect(wrapper.text()).toContain('Source bytes are not a supported image.');
	});

	it('reuses the persisted initiation identity when the first response is lost', async () => {
		const wrapper = await mountPage();
		const file = new File([new Uint8Array(68)], 'reconnect.png', { type: 'image/png' });
		const createdOperation = {
			...completedOperation,
			stage: 'created' as const,
			report: undefined,
			result: undefined,
			transferredByteLength: 0,
		};
		mockApiFetch
			.mockRejectedValueOnce(new Error('Response connection lost'))
			.mockResolvedValueOnce(createdOperation);
		mockTransferFetch.mockResolvedValue(new Response(JSON.stringify(completedOperation), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		}));

		wrapper.getComponent(fileUploadStub).vm.$emit('update:modelValue', file);
		await flushPromises();
		await wrapper.get('[data-testid="upload-image"]').trigger('click');
		await flushPromises();

		const pending = JSON.parse(
			localStorage.getItem('graphics-asset-ingestion-initiation')!,
		) as { idempotencyKey: string };
		expect(pending.idempotencyKey).toBeTruthy();

		await wrapper.get('[data-testid="upload-image"]').trigger('click');
		await flushPromises();

		const initiationCalls = mockApiFetch.mock.calls
			.filter(([path]) => path === '/api/graphics-assets/ingestion-operations');
		expect(initiationCalls).toHaveLength(2);
		expect(initiationCalls[0]![1].body.idempotencyKey)
			.toBe(initiationCalls[1]![1].body.idempotencyKey);
		expect(mockTransferFetch).toHaveBeenCalledOnce();
	});

	it('reconnects a durable initiation after the page reloads before receiving its response', async () => {
		const pending = {
			idempotencyKey: 'persisted-initiation',
			name: 'Reloaded scoreboard',
			defaultEventId: 7,
			duplicateContentPolicy: 'reuse',
			declaredByteLength: 68,
		};
		localStorage.setItem(
			'graphics-asset-ingestion-initiation',
			JSON.stringify(pending),
		);
		mockApiFetch.mockResolvedValue({
			...completedOperation,
			...pending,
			stage: 'created',
			report: undefined,
			result: undefined,
			transferredByteLength: 0,
		});

		const wrapper = await mountPage();
		await flushPromises();

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/graphics-assets/ingestion-operations',
			{ method: 'POST', body: pending },
		);
		expect(wrapper.text()).toContain('created');
		expect(localStorage.getItem('graphics-asset-ingestion-operation')).toBe('operation-1');
		expect(localStorage.getItem('graphics-asset-ingestion-initiation')).toBeNull();
	});

	it('lets an author explicitly request a separate Graphic Asset identity', async () => {
		const wrapper = await mountPage();
		const file = new File([new Uint8Array(68)], 'separate.png', { type: 'image/png' });
		mockApiFetch.mockRejectedValue(new Error('Stop after initiation'));

		wrapper.getComponent(fileUploadStub).vm.$emit('update:modelValue', file);
		await wrapper.get('input[type="checkbox"]').setValue(true);
		await flushPromises();
		await wrapper.get('[data-testid="upload-image"]').trigger('click');
		await flushPromises();

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/graphics-assets/ingestion-operations',
			expect.objectContaining({
				body: expect.objectContaining({
					duplicateContentPolicy: 'create-separate',
				}),
			}),
		);
	});
});
