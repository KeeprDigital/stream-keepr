import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import PackageImport from '~/components/Graphics/PackageImport.vue';

// The package-import surface the three graphics libraries share.

enableAutoUnmount(afterEach);

const UButtonStub = defineComponent({
	name: 'UButton',
	props: {
		disabled: { type: Boolean, default: false },
	},
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

async function mountImport(props: Record<string, unknown> = {}) {
	return mount(PackageImport, {
		props: {
			kind: 'skgraphic',
			testId: 'library-import',
			writable: true,
			...props,
		},
		global: {
			stubs: { UButton: UButtonStub },
		},
	});
}

/** Choosing an archive the way an author does, through the hidden file input. */
async function chooseFile(wrapper: Awaited<ReturnType<typeof mountImport>>, name = 'show.skgraphic') {
	const input = wrapper.get<HTMLInputElement>('[data-testid="library-import-input"]');
	const file = new File([
		new Uint8Array([1, 2, 3]),
	], name);
	Object.defineProperty(input.element, 'files', {
		value: [file],
		configurable: true,
	});
	await input.trigger('change');
	return file;
}

describe('graphicsPackageImport', () => {
	// The noun and the accepted extension are two facts about one artifact kind, so the component
	// is told the kind and derives both.
	it('names the artifact it receives and accepts exactly what that artifact travels as', async () => {
		// Both Template Package kinds share the noun and differ in extension, which is why
		// the pairing is a table rather than one derived string.
		const graphic = await mountImport({ kind: 'skgraphic' });

		expect(graphic.get('[data-testid="library-import"]').text()).toBe('Import a Template Package');
		expect(graphic.get<HTMLInputElement>('[data-testid="library-import-input"]')
			.attributes('accept')).toBe('.skgraphic');

		const layout = await mountImport({ kind: 'sklayout' });

		expect(layout.get('[data-testid="library-import"]').text()).toBe('Import a Template Package');
		expect(layout.get<HTMLInputElement>('[data-testid="library-import-input"]')
			.attributes('accept')).toBe('.sklayout');
	});

	// The component receives the file and stops there.
	it('hands the chosen archive back instead of importing it', async () => {
		const wrapper = await mountImport();

		const chosen = await chooseFile(wrapper);

		expect(wrapper.emitted('file')).toEqual([
			[chosen],
		]);
		// Cleared straight away, so choosing the same file twice still fires a change.
		expect(wrapper.get<HTMLInputElement>('[data-testid="library-import-input"]').element.value)
			.toBe('');
	});

	it('asks the author to accept a proposal that paused for one', async () => {
		const wrapper = await mountImport({
			reported: true,
			awaitingConfirmation: true,
			issues: [
				{
					code: 'graphic-asset-name-differs',
					message: 'A name differs',
					remediation: 'Review it',
				},
			],
		});

		const report = wrapper.get('[data-testid="library-import-report"]');
		expect(report.text()).toContain('Review before installing this Template Package');
		expect(report.text()).toContain('A name differs — Review it');

		await wrapper.get('[data-testid="library-import-confirm"]').trigger('click');
		expect(wrapper.emitted('confirm')).toHaveLength(1);
		// The one way out of a pause is stated as a cancellation, not as a dismissal.
		expect(wrapper.get('[data-testid="library-import-dismiss"]').text()).toBe('Cancel');
	});

	/** A rejection is terminal: it explains itself and offers nothing to install. */
	it('offers no way to install a package it reports as rejected', async () => {
		const wrapper = await mountImport({
			reported: true,
			rejected: true,
			issues: [
				{ code: 'unsupported-application-capability', message: 'Not supported here' },
			],
		});

		const report = wrapper.get('[data-testid="library-import-report"]');
		expect(report.text()).toContain('This Template Package cannot be installed');
		expect(wrapper.find('[data-testid="library-import-confirm"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="library-import-dismiss"]').text()).toBe('Dismiss');
	});

	it('offers an observer no import at all, while still reporting one already received', async () => {
		const wrapper = await mountImport({ writable: false, reported: true, issues: [] });

		expect(wrapper.find('[data-testid="library-import"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="library-import-input"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="library-import-report"]').exists()).toBe(true);
	});
});
