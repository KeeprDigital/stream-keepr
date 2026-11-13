import type { EffectScope } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, effectScope, h, ref } from 'vue';
import { stubImageLoading } from '~~/test/nuxt/helpers/imageLoading';
import { provideScreenModeReadiness, useScreenModeReady, useStagedScreenContent } from '~/modules/screen-mode/readiness';

const images = stubImageLoading();

describe('provideScreenModeReadiness', () => {
	/** Mounts a host holding one child per declaration, and answers what the host sees. */
	function hostDeclaring(declarations: Array<ReturnType<typeof ref<boolean>>>) {
		let declared: ReturnType<typeof provideScreenModeReadiness>['declared'] | undefined;
		const Child = defineComponent({
			props: {
				index: { type: Number, required: true },
			},
			setup(props) {
				useScreenModeReady(() => declarations[props.index]!.value!);
				return () => null;
			},
		});
		const shown = ref(declarations.map(() => true));
		const wrapper = mount(defineComponent({
			setup() {
				declared = provideScreenModeReadiness().declared;
				return () => h('div', declarations.map((_, index) => shown.value[index]
					? h(Child, { index })
					: null));
			},
		}));
		return { declared: declared!, shown, wrapper };
	}

	// A display declares once its async chunk has loaded, so silence is not readiness.
	it.each([
		['nothing has declared', [], false],
		[
			'every declaration holds',
			[true, true],
			true,
		],
		[
			'one declaration does not',
			[true, false],
			false,
		],
	])('is ready when %s', (_, values, expected) => {
		const { declared } = hostDeclaring(values.map(value => ref(value)));

		expect(declared.value).toBe(expected);
	});

	it('forgets a declaration whose component unmounts', async () => {
		const { declared, shown } = hostDeclaring([
			ref(true),
			ref(false),
		]);
		expect(declared.value).toBe(false);

		shown.value = [true, false];
		await flushPromises();

		expect(declared.value).toBe(true);
	});
});

describe('useStagedScreenContent', () => {
	const scopes: EffectScope[] = [];

	function staged() {
		const content = ref<string[]>([]);
		const scope = effectScope();
		scopes.push(scope);
		const result = scope.run(() => useStagedScreenContent(() => content.value, urls => urls))!;
		return { content, ...result };
	}

	beforeEach(() => {
		images.reset();
	});

	afterEach(() => {
		for (const scope of scopes.splice(0))
			scope.stop();
	});

	it('holds what it shows until the images of what replaces it have loaded', async () => {
		const { content, shown, staging } = staged();
		content.value = ['a.jpg'];
		await flushPromises();
		images.hold('b.jpg');

		content.value = ['b.jpg'];
		await flushPromises();
		expect(shown.value).toEqual(['a.jpg']);
		expect(staging.value).toBe(true);

		images.release('b.jpg');
		await flushPromises();

		expect(shown.value).toEqual(['b.jpg']);
		expect(staging.value).toBe(false);
	});

	it('shows a newer change rather than one it superseded while loading', async () => {
		const { content, shown } = staged();
		images.hold('slow.jpg');
		content.value = ['slow.jpg'];
		await flushPromises();

		content.value = ['fast.jpg'];
		await flushPromises();
		images.release('slow.jpg');
		await flushPromises();

		expect(shown.value).toEqual(['fast.jpg']);
	});

	it('shows a change whose image failed, leaving its fallback to the rendering', async () => {
		const { content, shown, staging } = staged();
		images.fail('broken.jpg');

		content.value = ['broken.jpg'];
		await flushPromises();

		expect(shown.value).toEqual(['broken.jpg']);
		expect(staging.value).toBe(false);
	});
});
