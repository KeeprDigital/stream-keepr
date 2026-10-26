import type {
	GraphicAsset,
	GraphicAssetUsage,
	GraphicsAssetLibraryCapacity,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';
import {
	GRAPHICS_MULTIPART_PART_BYTES,
	MAX_STILL_IMAGE_INGESTION_BYTES,
} from '~~/shared/utils/graphicsAssetCompatibility';
import { transportFailure } from '~~/test/helpers/transportFailure';

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
	source: 'local-upload',
	// A graphics author session id, which is what an operation records now that
	// the session is the author identity.
	initiatedBy: 'f2b1c4d6-9a83-4e17-8b5c-2d7e6a091f34',
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

const assets = ref<GraphicAsset[]>([
	{
		id: 'asset-1' as never,
		name: 'Scoreboard logo',
		kind: 'image',
		revisionId: 'revision-1' as never,
		revisionNumber: 1,
		revisions: [
			{
				id: 'revision-1' as never,
				revisionNumber: 1,
				facts: completedOperation.report!.outcome === 'accepted'
					? completedOperation.report!.facts
					: {} as never,
			},
		],
		lifecycle: { state: 'active' },
		facts: completedOperation.report!.outcome === 'accepted'
			? completedOperation.report!.facts
			: {} as never,
		eventIds: [7],
		operation: completedOperation,
	},
]);
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
/** The failure each `useFetch` read answers with, settable per test. */
const listingError = ref<unknown>(null);
const capacityLoadError = ref<unknown>(null);

mockNuxtImport('useFetch', () => (path: string) => ({
	data: path === '/api/graphics-assets/capacity'
		? capacity
		: assets,
	status: ref('success'),
	error: path === '/api/graphics-assets/capacity'
		? capacityLoadError
		: listingError,
	refresh: path === '/api/graphics-assets/capacity'
		? mockCapacityRefresh
		: mockRefresh,
}));

const passthroughStub = defineComponent({
	template: '<div><slot name="actions" /><slot name="header" /><slot /><slot name="footer" /></div>',
});
/** Renders `title`, which this page's alerts pass their message through (#365). */
const alertStub = defineComponent({
	props: ['title'],
	template: '<div><slot name="actions" /><slot name="header" /><span v-if="title">{{ title }}</span><slot /><slot name="footer" /></div>',
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
				UAlert: alertStub,
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
		listingError.value = null;
		capacityLoadError.value = null;
		assets.value = [
			{
				id: 'asset-1' as never,
				name: 'Scoreboard logo',
				kind: 'image',
				revisionId: 'revision-1' as never,
				revisionNumber: 1,
				revisions: [
					{
						id: 'revision-1' as never,
						revisionNumber: 1,
						facts: completedOperation.report!.outcome === 'accepted'
							? completedOperation.report!.facts
							: {} as never,
					},
				],
				lifecycle: { state: 'active' },
				facts: completedOperation.report!.outcome === 'accepted'
					? completedOperation.report!.facts
					: {} as never,
				eventIds: [7],
				operation: completedOperation,
			},
		];
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
		expect(wrapper.text()).toContain('Active assets');
		expect(wrapper.text()).toContain('Retired assets');
		expect(wrapper.text()).toContain('Trash');
		expect(wrapper.text()).toContain('Revision history');
		expect(wrapper.text()).toContain('Revision 1');
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

	it('inspects each exact Graphic Asset Revision with the owning graphics artifact and Event context', async () => {
		const usage: GraphicAssetUsage[] = [
			{
				id: 'usage-1',
				reference: {
					assetId: 'asset-1' as never,
					revisionId: 'revision-older' as never,
				},
				owner: {
					kind: 'screen',
					id: '42',
					name: 'Main Feature Match',
					slot: 'layout.frame.backgroundImage',
					eventId: 7,
				},
			},
		];
		mockApiFetch.mockResolvedValueOnce(usage);
		const wrapper = await mountPage();

		const inspect = wrapper.findAll('button')
			.find(button => button.text().includes('Inspect exact usage'));
		await inspect!.trigger('click');
		await flushPromises();

		expect(mockApiFetch).toHaveBeenCalledWith('/api/graphics-assets/asset-1/usage');
		expect(wrapper.text()).toContain('Main Feature Match');
		expect(wrapper.text()).toContain('Screen 42');
		expect(wrapper.text()).toContain('Event 7');
		expect(wrapper.text()).toContain('revision-older');
		expect(wrapper.text()).toContain('Pinned older Graphic Asset Revision');
	});

	it('updates Graphic Asset metadata and Event associations without presenting them as Graphic Asset Revision changes', async () => {
		mockApiFetch.mockResolvedValueOnce(assets.value[0]);
		const wrapper = await mountPage();
		const edit = wrapper.findAll('button')
			.find(button => button.text().includes('Edit metadata'));
		await edit!.trigger('click');
		const inputs = wrapper.findAll('input');
		await inputs.at(-2)!.setValue('Renamed scoreboard logo');
		await inputs.at(-1)!.setValue('7, 9');
		const save = wrapper.findAll('button')
			.find(button => button.text().includes('Save metadata'));
		await save!.trigger('click');
		await flushPromises();

		expect(mockApiFetch).toHaveBeenCalledWith('/api/graphics-assets/asset-1', {
			method: 'PATCH',
			body: {
				name: 'Renamed scoreboard logo',
				eventIds: [7, 9],
			},
		});
		expect(mockRefresh).toHaveBeenCalledOnce();
	});

	it('starts a Graphics Ingestion Operation and uploads exact Graphic Asset Content for an immutable Graphic Asset Revision', async () => {
		const replacementFile = new File([jpegPixel], 'replacement.jpg', { type: 'image/jpeg' });
		const created: GraphicsIngestionOperation = {
			...completedJpegOperation,
			targetAssetId: 'asset-1' as never,
			stage: 'created',
			transferredByteLength: 0,
			report: undefined,
			result: undefined,
		};
		const replaced: GraphicsIngestionOperation = {
			...completedJpegOperation,
			targetAssetId: 'asset-1' as never,
			result: {
				outcome: 'revision-created',
				assetId: 'asset-1' as never,
				revisionId: 'revision-2' as never,
			},
		};
		mockApiFetch
			.mockResolvedValueOnce(created)
			.mockResolvedValueOnce(replaced)
			.mockResolvedValueOnce([]);
		const wrapper = await mountPage();

		const replace = wrapper.findAll('button')
			.find(button => button.text().includes('Replace content'));
		await replace!.trigger('click');
		wrapper.findAllComponents(fileUploadStub).at(-1)!.vm.$emit(
			'update:modelValue',
			replacementFile,
		);
		await flushPromises();
		const publish = wrapper.findAll('button')
			.find(button => button.text().includes('Replace with new Graphic Asset Revision'));
		await publish!.trigger('click');
		await flushPromises();

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/graphics-assets/asset-1/replacement-operations',
			expect.objectContaining({
				method: 'POST',
				body: expect.objectContaining({
					sourceFileName: 'replacement.jpg',
					declaredMime: 'image/jpeg',
					declaredByteLength: jpegPixel.byteLength,
				}),
			}),
		);
		// The shared ingestion transfer carries the body now (#150); the File's
		// own type still names the content type at the fetch layer.
		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/graphics-assets/ingestion-operations/operation-1/content',
			expect.objectContaining({
				method: 'PUT',
				body: replacementFile,
			}),
		);
		expect(mockRefresh).toHaveBeenCalledOnce();
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
		mockApiFetch.mockImplementation((path: string, request?: { method?: string }) =>
			Promise.resolve(path.endsWith('/content') && request?.method === 'PUT'
				? completedJpegOperation
				: {
						...completedJpegOperation,
						stage: 'created',
						report: undefined,
						result: undefined,
						transferredByteLength: 0,
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
		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/graphics-assets/ingestion-operations/operation-1/content',
			expect.objectContaining({
				method: 'PUT',
				body: file,
			}),
		);
		expect(mockRefresh).toHaveBeenCalledOnce();
		expect(wrapper.text()).toContain(
			'Published Graphic Asset asset-1 Graphic Asset Revision revision-1',
		);
		expect(wrapper.text()).toContain('Exact source browser decode verified before publication.');
	});

	it('cancels a reconnected multipart operation through its durable identity', async () => {
		const active: GraphicsIngestionOperation = {
			...completedOperation,
			declaredByteLength: GRAPHICS_MULTIPART_PART_BYTES + 1,
			transferredByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			stage: 'transferring',
			report: undefined,
			result: undefined,
			transfer: {
				method: 'multipart',
				partByteLength: GRAPHICS_MULTIPART_PART_BYTES,
				maximumConcurrentParts: 3,
				maximumPartAttempts: 3,
				partCount: 2,
				cleanupPending: false,
				completedParts: [
					{
						partNumber: 1,
						partIdentity: 'operation-1:1' as never,
						byteLength: GRAPHICS_MULTIPART_PART_BYTES,
					},
				],
			},
		};
		const cancelled: GraphicsIngestionOperation = {
			...active,
			stage: 'cancelled',
			transfer: { ...active.transfer!, cleanupPending: false },
			failure: {
				code: 'ingestion-cancelled',
				retryable: false,
				message: 'Graphics ingestion was cancelled before publication.',
			},
		};
		localStorage.setItem('graphics-asset-ingestion-operation', active.id);
		mockApiFetch.mockImplementation((_path: string, options?: { method?: string }) =>
			Promise.resolve(options?.method === 'DELETE'
				? cancelled
				: active));

		const wrapper = await mountPage();
		await flushPromises();
		const cancelButton = wrapper.findAll('button')
			.find(button => button.text().includes('Cancel ingestion'));
		expect(cancelButton).toBeDefined();
		await cancelButton!.trigger('click');
		await flushPromises();

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/graphics-assets/ingestion-operations/operation-1',
			{ method: 'DELETE' },
		);
		expect(wrapper.text()).toContain('cancelled');
		expect(localStorage.getItem('graphics-asset-ingestion-operation')).toBeNull();
	});

	it('preserves the server validation report when malformed input cannot be accepted', async () => {
		const wrapper = await mountPage();
		const malformed = new File([
			new TextEncoder().encode('not a jpeg'),
		], 'malformed.jpg', {
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
				issues: [
					{
						severity: 'error',
						code: 'unsupported-image-format',
						message: 'Source bytes are not a supported image.',
					},
				],
			},
			failure: {
				code: 'validation-failed',
				retryable: false,
				message: 'Image did not satisfy the compatibility profile.',
			},
		};
		mockApiFetch.mockImplementation((_path: string, request?: { method?: string }) =>
			Promise.resolve(request?.method === 'PUT'
				? failed
				: created));

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
		const file = new File([
			new Uint8Array(68),
		], 'reconnect.png', { type: 'image/png' });
		const createdOperation = {
			...completedOperation,
			stage: 'created' as const,
			report: undefined,
			result: undefined,
			transferredByteLength: 0,
		};
		let initiationAttempts = 0;
		mockApiFetch.mockImplementation((path: string, request?: { method?: string }) => {
			if (path === '/api/graphics-assets/ingestion-operations' && request?.method === 'POST') {
				return ++initiationAttempts === 1
					? Promise.reject(new Error('Response connection lost'))
					: Promise.resolve(createdOperation);
			}
			if (request?.method === 'PUT')
				return Promise.resolve(completedOperation);
			return Promise.resolve(createdOperation);
		});

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
		expect(mockApiFetch.mock.calls
			.filter(([path]) => String(path).endsWith('/content'))).toHaveLength(1);
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
		const file = new File([
			new Uint8Array(68),
		], 'separate.png', { type: 'image/png' });
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

	// ADR-0034: a saved template holds Retire back, and the refusal names it.
	it('names the saved templates that hold back a retirement', async () => {
		const usage: GraphicAssetUsage[] = [
			{
				id: 'usage-template',
				reference: {
					assetId: 'asset-1' as never,
					revisionId: 'revision-1' as never,
				},
				owner: {
					kind: 'broadcast-graphic-template',
					id: 'template-1',
					name: 'Lower third',
					slot: 'graphics.lower-third.items.plate.asset',
				},
			},
		];
		mockApiFetch.mockResolvedValueOnce({ outcome: 'in-use', usage });
		const wrapper = await mountPage();

		const retire = wrapper.findAll('button')
			.find(button => button.text() === 'Retire');
		await retire!.trigger('click');
		await flushPromises();

		expect(wrapper.text()).toContain('cannot be retired while a saved template references it: Lower third');
	});

	it('exposes reversible retirement and Trash actions with blocked usage and recovery facts', async () => {
		const usage: GraphicAssetUsage[] = [
			{
				id: 'usage-lifecycle',
				reference: {
					assetId: 'asset-1' as never,
					revisionId: 'revision-1' as never,
				},
				owner: {
					kind: 'screen',
					id: '42',
					name: 'Main output',
					slot: 'layout.frame.backgroundImage',
					eventId: 7,
				},
			},
		];
		mockApiFetch
			.mockResolvedValueOnce({
				outcome: 'retired',
				asset: {
					...assets.value[0]!,
					lifecycle: { state: 'retired' },
				},
			})
			.mockResolvedValueOnce({ outcome: 'in-use', usage });
		mockApiFetch.mockResolvedValueOnce({
			outcome: 'restored',
			asset: {
				...assets.value[0]!,
				lifecycle: { state: 'retired' },
			},
		});
		const wrapper = await mountPage();

		const retire = wrapper.findAll('button')
			.find(button => button.text() === 'Retire');
		await retire!.trigger('click');
		await flushPromises();
		expect(mockApiFetch).toHaveBeenNthCalledWith(
			1,
			'/api/graphics-assets/asset-1/lifecycle-actions',
			{
				method: 'POST',
				body: { action: 'retire' },
			},
		);

		const trash = wrapper.findAll('button')
			.find(button => button.text() === 'Move to Trash');
		await trash!.trigger('click');
		await flushPromises();
		expect(mockApiFetch).toHaveBeenNthCalledWith(
			2,
			'/api/graphics-assets/asset-1/lifecycle-actions',
			{
				method: 'POST',
				body: { action: 'trash' },
			},
		);
		expect(wrapper.text()).toContain('Main output');
		expect(wrapper.text()).toContain('cannot enter Trash');

		assets.value = [
			{
				...assets.value[0]!,
				lifecycle: {
					state: 'trashed',
					priorState: 'retired',
					trashedAt: '2026-07-28T00:00:00.000Z',
					recoverableUntil: '2026-08-27T00:00:00.000Z',
				},
			},
		];
		await flushPromises();
		expect(wrapper.text()).toContain('Trash');
		expect(wrapper.text()).toContain('Previously Retired');
		expect(wrapper.text()).toContain('Recoverable until');
		expect(wrapper.text()).toContain('Restore');
		expect(wrapper.text()).not.toContain('Edit metadata');
		expect(wrapper.text()).not.toContain('Replace content');

		const restore = wrapper.findAll('button')
			.find(button => button.text() === 'Restore');
		await restore!.trigger('click');
		await flushPromises();
		expect(mockApiFetch).toHaveBeenNthCalledWith(
			3,
			'/api/graphics-assets/asset-1/lifecycle-actions',
			{
				method: 'POST',
				body: { action: 'restore' },
			},
		);
	});

	it('copies an approved HTTPS source, confirms the staged bytes, and never stores the URL', async () => {
		const created: GraphicsIngestionOperation = {
			...completedOperation,
			id: 'operation-remote' as never,
			idempotencyKey: 'remote-1',
			source: 'remote-copy',
			name: 'Remote scoreboard logo',
			stage: 'created',
			declaredByteLength: MAX_STILL_IMAGE_INGESTION_BYTES,
			transferredByteLength: 0,
			report: undefined,
			result: undefined,
		};
		const awaitingConfirmation: GraphicsIngestionOperation = {
			...completedOperation,
			id: 'operation-remote' as never,
			idempotencyKey: 'remote-1',
			source: 'remote-copy',
			name: 'Remote scoreboard logo',
			stage: 'awaiting-confirmation',
			result: undefined,
		};
		const published: GraphicsIngestionOperation = {
			...awaitingConfirmation,
			stage: 'completed',
			result: {
				outcome: 'published',
				assetId: 'asset-remote' as never,
				revisionId: 'revision-remote' as never,
			},
		};
		mockApiFetch
			.mockResolvedValueOnce(created)
			.mockResolvedValueOnce(awaitingConfirmation)
			.mockResolvedValueOnce(published);
		mockTransferFetch.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
			status: 200,
			headers: { 'content-type': 'application/octet-stream' },
		}));
		const wrapper = await mountPage();

		await wrapper.get('[data-testid="remote-source-url"]').setValue(
			'https://cdn.example.com/scoreboard.png?signature=super-secret#fragment',
		);
		await wrapper.get('[data-testid="remote-source-name"]').setValue('Remote scoreboard logo');
		await wrapper.get('[data-testid="copy-remote-source"]').trigger('click');
		await flushPromises();

		expect(mockApiFetch).toHaveBeenNthCalledWith(
			1,
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				body: {
					idempotencyKey: expect.any(String),
					name: 'Remote scoreboard logo',
					source: 'remote-copy',
					sourceFileName: 'scoreboard.png',
					defaultEventId: 7,
					duplicateContentPolicy: 'reuse',
				},
			},
		);
		expect(mockApiFetch).toHaveBeenNthCalledWith(
			2,
			'/api/graphics-assets/ingestion-operations/operation-remote/remote-copy',
			{
				method: 'POST',
				body: {
					sourceUrl: 'https://cdn.example.com/scoreboard.png?signature=super-secret#fragment',
				},
			},
		);
		expect(mockTransferFetch).toHaveBeenCalledWith(
			'/api/graphics-assets/ingestion-operations/operation-remote/staged-source',
		);
		expect(mockApiFetch).toHaveBeenNthCalledWith(
			3,
			'/api/graphics-assets/ingestion-operations/operation-remote/browser-evidence',
			{
				method: 'POST',
				body: {
					outcome: 'decoded',
					sourceDigest: '431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460',
					width: 1,
					height: 1,
				},
			},
		);
		expect(wrapper.text()).toContain('Published');
		expect(mockRefresh).toHaveBeenCalled();
		expect(localStorage.getItem('graphics-asset-ingestion-operation')).toBeNull();
		expect(JSON.stringify(localStorage)).not.toContain('super-secret');
		expect(JSON.stringify(localStorage)).not.toContain('fragment');
	});

	it('reports a rejected remote destination with its stable code and blocks nothing else', async () => {
		const rejected: GraphicsIngestionOperation = {
			...completedOperation,
			id: 'operation-remote-rejected' as never,
			source: 'remote-copy',
			stage: 'failed',
			transferredByteLength: 0,
			failure: {
				code: 'remote-source-rejected',
				retryable: false,
				message: 'The approved remote Graphic Asset source was rejected before any byte was copied.',
			},
			report: {
				outcome: 'rejected',
				compatibilityProfile: 'still-image-v1',
				issues: [
					{
						severity: 'error',
						code: 'remote-source-destination-not-public',
						message: 'https://cdn.example.com does not name a public internet destination.',
					},
				],
			},
			result: undefined,
		};
		mockApiFetch
			.mockResolvedValueOnce({
				...rejected,
				stage: 'created',
				failure: undefined,
				report: undefined,
			})
			.mockResolvedValueOnce(rejected);
		const wrapper = await mountPage();

		await wrapper.get('[data-testid="remote-source-url"]').setValue(
			'https://cdn.example.com/scoreboard.png',
		);
		await wrapper.get('[data-testid="remote-source-name"]').setValue('Rejected remote source');
		await wrapper.get('[data-testid="copy-remote-source"]').trigger('click');
		await flushPromises();

		expect(wrapper.text()).toContain('remote-source-destination-not-public');
		expect(wrapper.text()).toContain('Approved remote copy');
		expect(wrapper.text()).toContain('failed');
		expect(wrapper.findAll('button').some(button =>
			button.text().includes('Retry from staged bytes')
			|| button.text().includes('Resume if interrupted'),
		)).toBe(false);
	});

	it('refuses a plaintext or credential-bearing remote source before contacting it', async () => {
		const wrapper = await mountPage();

		await wrapper.get('[data-testid="remote-source-name"]').setValue('Invalid remote source');
		await wrapper.get('[data-testid="remote-source-url"]').setValue(
			'http://cdn.example.com/scoreboard.png',
		);
		await flushPromises();
		expect(wrapper.get('[data-testid="remote-selection-error"]').text())
			.toContain('Only public HTTPS sources may be copied into the library.');
		expect(wrapper.get('[data-testid="copy-remote-source"]').attributes('disabled'))
			.toBeDefined();

		await wrapper.get('[data-testid="remote-source-url"]').setValue(
			'https://user:secret@cdn.example.com/scoreboard.png',
		);
		await flushPromises();
		expect(wrapper.get('[data-testid="remote-selection-error"]').text())
			.toContain('An approved remote source must not carry embedded credentials.');
		expect(wrapper.get('[data-testid="copy-remote-source"]').attributes('disabled'))
			.toBeDefined();
		expect(mockApiFetch).not.toHaveBeenCalled();
	});

	it('confirms a reconnected remote copy from its staged bytes without the original URL', async () => {
		const awaitingConfirmation: GraphicsIngestionOperation = {
			...completedOperation,
			id: 'operation-reconnected' as never,
			source: 'remote-copy',
			name: 'Reconnected remote copy',
			stage: 'awaiting-confirmation',
			result: undefined,
		};
		localStorage.setItem('graphics-asset-ingestion-operation', 'operation-reconnected');
		mockApiFetch
			.mockResolvedValueOnce(awaitingConfirmation)
			.mockResolvedValueOnce({
				...awaitingConfirmation,
				stage: 'completed',
				result: {
					outcome: 'published',
					assetId: 'asset-reconnected' as never,
					revisionId: 'revision-reconnected' as never,
				},
			});
		mockTransferFetch.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
			status: 200,
			headers: { 'content-type': 'application/octet-stream' },
		}));
		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.text()).toContain('Confirm the exact staged bytes in this browser');
		await wrapper.get('[data-testid="confirm-staged-source"]').trigger('click');
		await flushPromises();

		expect(mockTransferFetch).toHaveBeenCalledWith(
			'/api/graphics-assets/ingestion-operations/operation-reconnected/staged-source',
		);
		expect(mockApiFetch).toHaveBeenLastCalledWith(
			'/api/graphics-assets/ingestion-operations/operation-reconnected/browser-evidence',
			{
				method: 'POST',
				body: expect.objectContaining({ outcome: 'decoded' }),
			},
		);
		expect(wrapper.text()).toContain('Published');
	});

	// A read's 401 means this browser is signed out too, so it lights the writes' banner (#360, #398).
	it('names the ended session when the library listing answers 401, exactly as the writes do', async () => {
		listingError.value = transportFailure({
			status: 401,
			statusText: 'Unauthorized',
			body: { message: 'Authentication is required' },
			request: `[GET] "/api/graphics-assets"`,
		});
		const wrapper = await mountPage();

		const alert = wrapper.get('[data-testid="library-load-error"]');
		expect(alert.text()).toContain('This browser is no longer signed in');
		expect(alert.text()).not.toContain('401');
		expect(wrapper.find('[data-testid="sign-in-again"]').exists()).toBe(true);
	});

	it('says why an upload was refused rather than naming the route', async () => {
		const wrapper = await mountPage();
		const file = new File([
			new Uint8Array(68),
		], 'new-scoreboard.png', { type: 'image/png' });
		mockApiFetch.mockRejectedValue(transportFailure({
			status: 409,
			body: { message: 'A Graphic Asset already holds this exact content' },
			request: `[POST] "/api/graphics-assets/ingestion-operations"`,
		}));

		wrapper.getComponent(fileUploadStub).vm.$emit('update:modelValue', file);
		await flushPromises();
		await wrapper.get('[data-testid="upload-image"]').trigger('click');
		await flushPromises();

		const alert = wrapper.get('[data-testid="upload-error"]');
		expect(alert.text()).toContain('A Graphic Asset already holds this exact content');
		expect(alert.text()).not.toContain('409 Conflict');
	});

	// The two alerts that answer before any request exists; each must go once its input is fixed.
	// Credentials in a remote source are refused, never sent, and never printed back.
	it('says why a selected source cannot be uploaded, and stops once one that can is picked', async () => {
		const wrapper = await mountPage();

		wrapper.getComponent(fileUploadStub).vm.$emit(
			'update:modelValue',
			new File([
				new Uint8Array(8),
			], 'match-report.pdf', { type: 'application/pdf' }),
		);
		await flushPromises();

		expect(wrapper.get('[data-testid="selection-error"]').text())
			.toContain('Select a PNG, JPEG, WebP, H.264 MP4, VP9 WebM, WOFF2, WOFF, TTF, or OTF source.');

		wrapper.getComponent(fileUploadStub).vm.$emit(
			'update:modelValue',
			new File([jpegPixel], 'scoreboard.jpg', { type: 'image/jpeg' }),
		);
		await flushPromises();

		expect(wrapper.find('[data-testid="selection-error"]').exists()).toBe(false);
	});

	it('refuses a credential-bearing remote source without repeating the credentials', async () => {
		const wrapper = await mountPage();

		await wrapper.get('[data-testid="remote-source-url"]')
			.setValue('https://author:kestrel-passphrase@cdn.example.com/scoreboard.png');
		await flushPromises();

		const alert = wrapper.get('[data-testid="remote-selection-error"]');
		expect(alert.text()).toContain('An approved remote source must not carry embedded credentials.');
		expect(alert.text()).not.toContain('kestrel-passphrase');

		await wrapper.get('[data-testid="remote-source-url"]')
			.setValue('https://cdn.example.com/scoreboard.png');
		await flushPromises();

		expect(wrapper.find('[data-testid="remote-selection-error"]').exists()).toBe(false);
	});
});

/**
 * Assert each alert through its own `data-testid`: `wrapper.text()` passes off any element
 * carrying the same words. An Ingestion Operation belongs to one author session (ADR-0010);
 * the Workspace says so before an upload, and names the lapse rather than the status.
 */
describe('the Library Workspace when its graphics author session decides ownership', () => {
	beforeEach(() => {
		mockApiFetch.mockReset();
		mockBrowserDecode.mockReset();
		mockBrowserDecode.mockResolvedValue({
			outcome: 'decoded',
			sourceDigest: '58a79b9921ff2dc8485bf82af9974e6e5f589000884ff9a1d3c5a82488032d05',
			width: 1,
			height: 1,
		});
		mockCapacityRefresh.mockReset();
		mockRefresh.mockReset();
		mockTransferFetch.mockReset();
		vi.stubGlobal('fetch', mockTransferFetch);
		localStorage.clear();
	});

	function endedSession() {
		return Object.assign(new Error('Authentication is required'), {
			statusCode: 401,
		});
	}

	it('says who an upload will belong to before one is started', async () => {
		const wrapper = await mountPage();

		expect(wrapper.text()).toContain('An upload belongs to your account');
		expect(wrapper.text()).toContain('outlives this browser');
		expect(wrapper.text()).toContain('Nobody else can resume it');
	});

	it('names an ended session rather than a status code when an upload is refused', async () => {
		const wrapper = await mountPage();
		const file = new File([jpegPixel], 'new-scoreboard.jpg', { type: 'image/jpeg' });
		mockApiFetch.mockRejectedValue(endedSession());

		wrapper.getComponent(fileUploadStub).vm.$emit('update:modelValue', file);
		await flushPromises();
		await wrapper.get('[data-testid="upload-image"]').trigger('click');
		await flushPromises();

		expect(wrapper.get('[data-testid="upload-error"]').text())
			.toContain('This browser is no longer signed in');
		expect(wrapper.find('[data-testid="sign-in-again"]').exists()).toBe(true);
		expect(wrapper.text()).not.toContain('401');
	});

	/**
	 * The other half of naming a lapse: not naming one.
	 *
	 * A `404` from an ingestion route is per-session ownership working — a live
	 * session asking about an operation that is not its own. Announcing a lapse for
	 * it would tell an author their session had ended when they are still holding
	 * it, and send them to reload for nothing.
	 */
	it('does not announce a lapse for an operation that is simply not this author\'s', async () => {
		const wrapper = await mountPage();
		const file = new File([jpegPixel], 'new-scoreboard.jpg', { type: 'image/jpeg' });
		mockApiFetch.mockRejectedValue(Object.assign(
			new Error('Graphics Ingestion Operation does not exist'),
			{ statusCode: 404 },
		));

		wrapper.getComponent(fileUploadStub).vm.$emit('update:modelValue', file);
		await flushPromises();
		await wrapper.get('[data-testid="upload-image"]').trigger('click');
		await flushPromises();

		expect(wrapper.get('[data-testid="upload-error"]').text())
			.toContain('Graphics Ingestion Operation does not exist');
		expect(wrapper.text()).not.toContain('This browser is no longer signed in');
		expect(wrapper.find('[data-testid="sign-in-again"]').exists()).toBe(false);
	});

	it('names an ended session when a resumable part is refused mid-transfer', async () => {
		const wrapper = await mountPage();
		const bytes = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES + 1);
		const file = new File([bytes], 'large-scoreboard.png', { type: 'image/png' });
		const created: GraphicsIngestionOperation = {
			...completedOperation,
			name: 'large-scoreboard.png',
			sourceFileName: 'large-scoreboard.png',
			declaredMime: 'image/png',
			declaredByteLength: bytes.byteLength,
			transferredByteLength: 0,
			stage: 'created',
			report: undefined,
			result: undefined,
		};
		const started: GraphicsIngestionOperation = {
			...created,
			stage: 'transferring',
			transfer: {
				method: 'multipart',
				partByteLength: GRAPHICS_MULTIPART_PART_BYTES,
				maximumConcurrentParts: 1,
				maximumPartAttempts: 3,
				partCount: 2,
				cleanupPending: false,
				completedParts: [],
			},
		};
		mockApiFetch.mockImplementation((path: string) => {
			if (path.includes('/multipart/parts/'))
				return Promise.reject(endedSession());
			return Promise.resolve(path.endsWith('/multipart')
				? started
				: created);
		});

		wrapper.getComponent(fileUploadStub).vm.$emit('update:modelValue', file);
		await flushPromises();
		await wrapper.get('[data-testid="upload-image"]').trigger('click');
		await flushPromises();

		expect(wrapper.get('[data-testid="upload-error"]').text())
			.toContain('This browser is no longer signed in');
		// A part the library refused for want of an author is not a part worth
		// sending again, so the transfer stops instead of exhausting its attempts.
		expect(mockApiFetch.mock.calls
			.filter(([path]) => String(path).includes('/multipart/parts/'))).toHaveLength(1);
	});

	it('names an ended session when an approved remote copy is refused', async () => {
		const wrapper = await mountPage();
		mockApiFetch.mockRejectedValue(endedSession());

		await wrapper.get('[data-testid="remote-source-url"]')
			.setValue('https://cdn.example.com/scoreboard.png');
		await wrapper.get('[data-testid="remote-source-name"]')
			.setValue('Remote scoreboard logo');
		await wrapper.get('[data-testid="copy-remote-source"]').trigger('click');
		await flushPromises();

		expect(wrapper.get('[data-testid="remote-copy-error"]').text())
			.toContain('This browser is no longer signed in');
	});

	/**
	 * ADR-0010's named residual case, at the exact moment it happens.
	 *
	 * An operation paused overnight is reconnected from a durable pointer in
	 * `localStorage` on the next visit. Until now that restore swallowed its own
	 * failure and deleted the pointer, so the one moment the decision costs an
	 * author something was the one moment they were told nothing at all — the
	 * workspace simply came up empty, as though there had never been an upload.
	 */
	it('says an operation could not be reconnected instead of dropping it in silence', async () => {
		localStorage.setItem('graphics-asset-ingestion-operation', 'operation-from-last-night');
		mockApiFetch.mockRejectedValue(Object.assign(
			new Error('Graphics Ingestion Operation does not exist'),
			{ statusCode: 404 },
		));
		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="upload-error"]').text())
			.toContain('could not be reconnected');
		// The pointer is still dropped — it names something unreachable — but the
		// author learns that rather than inferring it from an empty workspace.
		expect(localStorage.getItem('graphics-asset-ingestion-operation')).toBeNull();
	});

	it('names an ended session when the staged bytes of a remote copy cannot be read', async () => {
		const awaitingConfirmation: GraphicsIngestionOperation = {
			...completedOperation,
			id: 'operation-reconnected' as never,
			source: 'remote-copy',
			stage: 'awaiting-confirmation',
			result: undefined,
		};
		localStorage.setItem('graphics-asset-ingestion-operation', awaitingConfirmation.id);
		mockApiFetch.mockResolvedValue(awaitingConfirmation);
		mockTransferFetch.mockResolvedValue(new Response('', { status: 401 }));
		const wrapper = await mountPage();
		await flushPromises();

		await wrapper.get('[data-testid="confirm-staged-source"]').trigger('click');
		await flushPromises();

		expect(wrapper.get('[data-testid="remote-copy-error"]').text())
			.toContain('This browser is no longer signed in');
	});
});
