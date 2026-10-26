/**
 * Shared stand-ins for Nuxt UI components: plain semantic HTML that keeps each
 * component's v-model, emits, disabled state and slots, with fall-through attrs
 * (aria-*, data-*, listeners) on the control. Mount with
 * `global: { stubs: nuxtUiStubs }`; spread to override one: `{ ...nuxtUiStubs, UModal: MyModal }`.
 * Overlays (UModal, USlideover, UPopover, UDropdownMenu) render content only while open.
 */
import type { PropType } from 'vue';
import { computed, defineComponent, ref } from 'vue';

/** Look-only props every stub accepts and ignores, so they do not land in the DOM as attributes. */
const presentation = {
	color: { type: String, required: false },
	variant: { type: String, required: false },
	size: { type: String, required: false },
	ui: { type: Object, required: false },
} as const;

type ModelModifiers = Partial<Record<'trim' | 'number' | 'lazy' | 'nullable' | 'optional', boolean>>;

/** `UInput`'s own value pipeline: `.trim`, `.number` (or `type="number"`), `.nullable`, `.optional`. */
function inputValue(raw: string, type: string, modifiers: ModelModifiers = {}): unknown {
	let value: unknown = modifiers.trim
		? raw.trim()
		: raw;
	if (modifiers.number || type === 'number') {
		const number = Number.parseFloat(value as string);
		value = Number.isNaN(number)
			? value
			: number;
	}
	if (value === '' && modifiers.nullable)
		return null;
	if (value === '' && modifiers.optional)
		return undefined;
	return value;
}

const textControlProps = {
	...presentation,
	modelValue: {
		type: [String, Number, null] as PropType<string | number | null>,
		default: undefined,
	},
	modelModifiers: {
		type: Object as PropType<ModelModifiers>,
		default: () => ({}),
	},
	type: { type: String, default: 'text' },
	disabled: { type: Boolean, default: false },
} as const;

function textControl(name: 'UInput' | 'UTextarea', tag: 'input' | 'textarea') {
	return defineComponent({
		name,
		inheritAttrs: false,
		props: textControlProps,
		emits: [
			'update:modelValue',
			'change',
			'blur',
			'focus',
		],
		setup(props, { emit }) {
			const update = (event: Event) => emit('update:modelValue', inputValue((event.target as HTMLInputElement).value, props.type, props.modelModifiers));
			return {
				onInput: (event: Event) => props.modelModifiers.lazy || update(event),
				onChange: (event: Event) => {
					if (props.modelModifiers.lazy)
						update(event);
					emit('change', event);
				},
			};
		},
		template: `<span><slot name="leading" /><${tag} v-bind="$attrs" ${tag === 'input'
			? ':type="type"'
			: ''} :value="modelValue ?? ''" :disabled="disabled" @input="onInput" @change="onChange" @blur="$emit('blur', $event)" @focus="$emit('focus', $event)" /><slot name="trailing" /></span>`,
	});
}

export const UInputStub = textControl('UInput', 'input');
export const UTextareaStub = textControl('UTextarea', 'textarea');

/** `<input type="number">`; emits a number, or `null` when emptied. Does not clamp to min/max. */
export const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	inheritAttrs: false,
	props: {
		...presentation,
		modelValue: {
			type: [Number, null] as PropType<number | null>,
			default: undefined,
		},
		min: { type: Number, required: false },
		max: { type: Number, required: false },
		step: { type: Number, required: false },
		disabled: { type: Boolean, default: false },
	},
	emits: ['update:modelValue', 'change', 'blur'],
	setup(_, { emit }) {
		return {
			onInput(event: Event) {
				const raw = (event.target as HTMLInputElement).value;
				emit('update:modelValue', raw === ''
					? null
					: Number(raw));
			},
		};
	},
	template: '<input v-bind="$attrs" type="number" :value="modelValue ?? \'\'" :min="min" :max="max" :step="step" :disabled="disabled" @input="onInput" @change="$emit(\'change\', $event)" @blur="$emit(\'blur\', $event)" />',
});

interface SelectOption {
	key: string;
	label: string;
	value: unknown;
	disabled: boolean;
}

type SelectItem = string | number | boolean | null | Record<string, unknown>;

function selectOptions(items: SelectItem[] | SelectItem[][], valueKey: string | undefined, labelKey: string): SelectOption[] {
	return (items as SelectItem[]).flat().filter(item => !(item && typeof item === 'object' && (item.type === 'label' || item.type === 'separator'))).map((item, index) => {
		if (item === null || typeof item !== 'object') {
			return {
				key: String(item),
				label: String(item),
				value: item,
				disabled: false,
			};
		}
		const value = valueKey ? item[valueKey] : item;
		return {
			key: value !== null && typeof value === 'object'
				? String(index)
				: String(value),
			label: String(item[labelKey] ?? ''),
			value,
			disabled: Boolean(item.disabled),
		};
	});
}

function selectControl(name: 'USelect' | 'USelectMenu', defaultValueKey: string | undefined) {
	return defineComponent({
		name,
		props: {
			...presentation,
			modelValue: { type: null as unknown as PropType<unknown>, default: undefined },
			items: {
				type: Array as PropType<SelectItem[] | SelectItem[][]>,
				default: () => [],
			},
			valueKey: { type: String, default: defaultValueKey },
			labelKey: { type: String, default: 'label' },
			placeholder: { type: String, required: false },
			multiple: { type: Boolean, default: false },
			disabled: { type: Boolean, default: false },
		},
		emits: ['update:modelValue', 'change'],
		setup(props, { emit }) {
			const options = computed(() => selectOptions(props.items, props.valueKey, props.labelKey));
			const same = (a: unknown, b: unknown) => a === b || (a !== null && typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b));
			const isSelected = (option: SelectOption) => {
				const model: unknown = props.modelValue;
				return props.multiple
					? Array.isArray(model) && model.some(value => same(value, option.value))
					: same(model, option.value);
			};
			return {
				options,
				isSelected,
				hasSelection: computed(() => options.value.some(isSelected)),
				onChange(event: Event) {
					const select = event.target as HTMLSelectElement;
					const chosen = options.value.filter(option => [...select.selectedOptions].some(selected => selected.value === option.key));
					emit('update:modelValue', props.multiple
						? chosen.map(option => option.value)
						: chosen[0]?.value);
					emit('change', event);
				},
			};
		},
		template: `<select :multiple="multiple" :disabled="disabled" @change="onChange">
			<option v-if="!multiple && !hasSelection" value="" disabled selected hidden>{{ placeholder }}</option>
			<option v-for="option in options" :key="option.key" :value="option.key" :selected="isSelected(option)" :disabled="option.disabled">{{ option.label }}</option>
		</select>`,
	});
}

/** Native `<select>`; emits the chosen item's typed `value` (not the option's string), as `USelect` does. */
export const USelectStub = selectControl('USelect', 'value');
/** As `USelectStub`, but without `value-key` it emits the whole item object, as `USelectMenu` does. */
export const USelectMenuStub = selectControl('USelectMenu', undefined);

const toggleProps = {
	...presentation,
	modelValue: {
		type: [Boolean, String] as PropType<boolean | 'indeterminate'>,
		default: false,
	},
	label: { type: String, required: false },
	description: { type: String, required: false },
	disabled: { type: Boolean, default: false },
} as const;

function toggleControl(name: 'USwitch' | 'UCheckbox', role: 'switch' | 'checkbox') {
	return defineComponent({
		name,
		inheritAttrs: false,
		props: toggleProps,
		emits: ['update:modelValue', 'change'],
		template: `<div><button v-bind="$attrs" type="button" role="${role}" :aria-checked="modelValue === 'indeterminate' ? 'mixed' : String(modelValue)" :disabled="disabled" @click="$emit('update:modelValue', modelValue !== true); $emit('change', $event)"><slot name="label">{{ label }}</slot></button><p v-if="description || $slots.description"><slot name="description">{{ description }}</slot></p></div>`,
	});
}

/** `<button role="switch">`; click emits the toggled value. Its label is the button's text. */
export const USwitchStub = toggleControl('USwitch', 'switch');
/** `<button role="checkbox">`, as Nuxt UI renders it; click emits the toggled value. */
export const UCheckboxStub = toggleControl('UCheckbox', 'checkbox');

/** `<button>` (or `<a>` with `to`/`href`); disabled while `loading`. Clicks reach `@click` natively. */
export const UButtonStub = defineComponent({
	name: 'UButton',
	props: {
		...presentation,
		label: { type: String, required: false },
		icon: { type: String, required: false },
		trailingIcon: { type: String, required: false },
		loading: { type: Boolean, default: false },
		disabled: { type: Boolean, default: false },
		type: { type: String, default: 'button' },
		to: {
			type: [String, Object],
			required: false,
		},
		href: { type: String, required: false },
		block: { type: Boolean, required: false },
		square: { type: Boolean, required: false },
	},
	setup(props) {
		return {
			link: computed(() => typeof props.to === 'string'
				? props.to
				: props.href),
		};
	},
	template: `<component :is="link ? 'a' : 'button'" :href="link" :type="link ? undefined : type" :disabled="link ? undefined : disabled || loading" :aria-busy="loading || undefined">
		<slot name="leading"><span v-if="icon" :data-icon="icon" aria-hidden="true" /></slot>
		<slot>{{ label }}</slot>
		<slot name="trailing"><span v-if="trailingIcon" :data-icon="trailingIcon" aria-hidden="true" /></slot>
	</component>`,
});

/** Wraps its control in a `<label>`; a string `error` renders as `[data-error]`. Root carries `data-field="<name>"`. */
export const UFormFieldStub = defineComponent({
	name: 'UFormField',
	props: {
		...presentation,
		label: { type: String, required: false },
		name: { type: String, required: false },
		description: { type: String, required: false },
		help: { type: String, required: false },
		hint: { type: String, required: false },
		error: {
			type: [String, Boolean],
			required: false,
		},
		required: { type: Boolean, required: false },
	},
	template: `<div :data-field="name">
		<label><span><slot name="label">{{ label }}</slot></span><slot /></label>
		<p v-if="description || $slots.description"><slot name="description">{{ description }}</slot></p>
		<p v-if="typeof error === 'string' && error" data-error>{{ error }}</p>
		<p v-else-if="help">{{ help }}</p>
	</div>`,
});

interface StandardSchema {
	'~standard': {
		validate: (value: unknown) => { value?: unknown; issues?: readonly { message: string; path?: readonly unknown[] }[] }
			| Promise<{ value?: unknown; issues?: readonly { message: string; path?: readonly unknown[] }[] }>;
	};
}

/**
 * `<form>` that, like `UForm`, validates `state` against a Standard Schema
 * `schema` on submit: `@submit` gets `{ data }` (the parsed output), or
 * `@error` gets `{ errors: [{ name, message }] }`. Submission is async: `await flushPromises()`.
 */
export const UFormStub = defineComponent({
	name: 'UForm',
	props: {
		state: { type: Object, required: false },
		schema: { type: Object as PropType<StandardSchema>, required: false },
		onSubmit: { type: Function as PropType<(event: Event & { data: unknown }) => unknown>, required: false },
		disabled: { type: Boolean, default: false },
	},
	emits: ['error'],
	setup(props, { emit, expose }) {
		async function submit(event: Event = new Event('submit')) {
			const result = props.schema
				? await props.schema['~standard'].validate(props.state)
				: { value: props.state };
			if (result.issues) {
				emit('error', Object.assign(event, {
					errors: result.issues.map(issue => ({
						name: issue.path?.join('.'),
						message: issue.message,
					})),
				}));
				return;
			}
			await props.onSubmit?.(Object.assign(event, { data: result.value }));
		}
		expose({ submit });
		return { submit };
	},
	template: '<form @submit.prevent="submit($event)"><fieldset :disabled="disabled" style="display: contents"><slot /></fieldset></form>',
});

const overlayProps = {
	...presentation,
	open: { type: Boolean, default: undefined },
	defaultOpen: { type: Boolean, default: false },
} as const;

/** Controlled by `open` when given, otherwise by clicks on the trigger slot, as Nuxt UI's overlays are. */
function useOpen(props: { open?: boolean; defaultOpen: boolean }, emit: (event: 'update:open', open: boolean) => void) {
	const uncontrolled = ref(props.defaultOpen);
	const isOpen = computed(() => props.open ?? uncontrolled.value);
	function setOpen(open: boolean) {
		uncontrolled.value = open;
		emit('update:open', open);
	}
	return {
		isOpen,
		setOpen,
		close: () => setOpen(false),
	};
}

function dialogOverlay(name: 'UModal' | 'USlideover') {
	return defineComponent({
		name,
		inheritAttrs: false,
		props: {
			...overlayProps,
			title: { type: String, required: false },
			description: { type: String, required: false },
			/** `false` hides the Close button; an object is its button props, `onClick` included. */
			close: {
				type: [Boolean, Object] as PropType<boolean | { onClick?: (event: MouseEvent) => void }>,
				default: true,
			},
			dismissible: { type: Boolean, default: true },
		},
		emits: ['update:open'],
		setup(props, { emit }) {
			const open = useOpen(props, emit);
			return {
				...open,
				onCloseButton(event: MouseEvent) {
					if (typeof props.close === 'object')
						props.close.onClick?.(event);
					open.close();
				},
			};
		},
		template: `<span v-if="$slots.default" @click="setOpen(true)"><slot :open="isOpen" /></span>
		<div v-if="isOpen" v-bind="$attrs" role="dialog" aria-modal="true" :aria-label="title">
			<slot name="content" :close="close">
				<slot name="header" :close="close">
					<h2 v-if="title || $slots.title"><slot name="title">{{ title }}</slot></h2>
					<p v-if="description || $slots.description"><slot name="description">{{ description }}</slot></p>
					<button v-if="$props.close" type="button" aria-label="Close" @click="onCloseButton" />
				</slot>
				<slot name="body" :close="close" />
				<slot name="footer" :close="close" />
			</slot>
		</div>`,
	});
}

/** A `role="dialog"` with title, description, Close button and body/footer slots (each given `{ close }`). */
export const UModalStub = dialogOverlay('UModal');
export const USlideoverStub = dialogOverlay('USlideover');

/** Trigger slot, then the `content` slot (given `{ close }`) while open. */
export const UPopoverStub = defineComponent({
	name: 'UPopover',
	props: overlayProps,
	emits: ['update:open'],
	setup: (props, { emit }) => useOpen(props, emit),
	template: '<div><span @click="setOpen(!isOpen)"><slot :open="isOpen" /></span><div v-if="isOpen"><slot name="content" :close="close" /></div></div>',
});

interface DropdownItem {
	label?: string;
	type?: 'label' | 'separator' | 'checkbox' | 'link';
	disabled?: boolean;
	checked?: boolean;
	onSelect?: (event: Event) => void;
	onUpdateChecked?: (checked: boolean) => void;
}

/**
 * Trigger slot, then while open a `role="menu"` of `role="menuitem"` buttons
 * (`menuitemcheckbox` for checkbox items). Choosing calls `onSelect` and closes,
 * unless `onSelect` calls `event.preventDefault()`.
 */
export const UDropdownMenuStub = defineComponent({
	name: 'UDropdownMenu',
	props: {
		...overlayProps,
		items: {
			type: Array as PropType<DropdownItem[] | DropdownItem[][]>,
			default: () => [],
		},
	},
	emits: ['update:open'],
	setup(props, { emit }) {
		const open = useOpen(props, emit);
		return {
			...open,
			entries: computed(() => (props.items as DropdownItem[]).flat()),
			choose(item: DropdownItem, event: Event) {
				if (item.type === 'checkbox')
					item.onUpdateChecked?.(!item.checked);
				item.onSelect?.(event);
				if (!event.defaultPrevented)
					open.close();
			},
		};
	},
	template: `<div><span @click="setOpen(!isOpen)"><slot :open="isOpen" /></span>
	<div v-if="isOpen" role="menu">
		<template v-for="(item, index) in entries" :key="index">
			<hr v-if="item.type === 'separator'">
			<div v-else-if="item.type === 'label'">{{ item.label }}</div>
			<button v-else type="button" :role="item.type === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'" :aria-checked="item.type === 'checkbox' ? String(!!item.checked) : undefined" :disabled="item.disabled" @click="choose(item, $event)"><slot name="item-label" :item="item" :index="index">{{ item.label }}</slot></button>
		</template>
	</div></div>`,
});

/** Renders only its trigger; the tooltip text is exposed as `data-tooltip`, never shown. */
export const UTooltipStub = defineComponent({
	name: 'UTooltip',
	props: {
		...presentation,
		text: { type: String, required: false },
	},
	template: '<span :data-tooltip="text"><slot /></span>',
});

export const UCardStub = defineComponent({
	name: 'UCard',
	props: presentation,
	template: '<section><header v-if="$slots.header"><slot name="header" /></header><slot /><footer v-if="$slots.footer"><slot name="footer" /></footer></section>',
});

/** Title, description and `actions` (button props) rendered; `color` kept as `data-color` for status. */
export const UAlertStub = defineComponent({
	name: 'UAlert',
	props: {
		...presentation,
		title: { type: String, required: false },
		description: { type: String, required: false },
		icon: { type: String, required: false },
		actions: {
			type: Array as PropType<{ label?: string; onClick?: (event: MouseEvent) => void; disabled?: boolean }[]>,
			default: () => [],
		},
	},
	template: `<div data-alert :data-color="color">
		<div v-if="title || $slots.title"><slot name="title">{{ title }}</slot></div>
		<div v-if="description || $slots.description"><slot name="description">{{ description }}</slot></div>
		<slot name="actions"><button v-for="(action, index) in actions" :key="index" type="button" :disabled="action.disabled" @click="action.onClick?.($event)">{{ action.label }}</button></slot>
	</div>`,
});

export const UBadgeStub = defineComponent({
	name: 'UBadge',
	props: {
		...presentation,
		label: {
			type: [String, Number],
			required: false,
		},
	},
	template: '<span :data-color="color"><slot>{{ label }}</slot></span>',
});

export const UIconStub = defineComponent({
	name: 'UIcon',
	props: {
		name: { type: String, required: false },
	},
	template: '<span :data-icon="name" aria-hidden="true" />',
});

export const UFieldGroupStub = defineComponent({ name: 'UFieldGroup', props: presentation, template: '<div><slot /></div>' });
export const UContainerStub = defineComponent({ name: 'UContainer', template: '<div><slot /></div>' });
export const USeparatorStub = defineComponent({
	name: 'USeparator',
	props: {
		...presentation,
		label: { type: String, required: false },
	},
	template: '<hr>',
});

/** Every stub above, keyed by component name, for `global.stubs`. */
export const nuxtUiStubs = {
	UAlert: UAlertStub,
	UBadge: UBadgeStub,
	UButton: UButtonStub,
	UCard: UCardStub,
	UCheckbox: UCheckboxStub,
	UContainer: UContainerStub,
	UDropdownMenu: UDropdownMenuStub,
	UFieldGroup: UFieldGroupStub,
	UForm: UFormStub,
	UFormField: UFormFieldStub,
	UIcon: UIconStub,
	UInput: UInputStub,
	UInputNumber: UInputNumberStub,
	UModal: UModalStub,
	UPopover: UPopoverStub,
	USelect: USelectStub,
	USelectMenu: USelectMenuStub,
	USeparator: USeparatorStub,
	USlideover: USlideoverStub,
	USwitch: USwitchStub,
	UTextarea: UTextareaStub,
	UTooltip: UTooltipStub,
};
