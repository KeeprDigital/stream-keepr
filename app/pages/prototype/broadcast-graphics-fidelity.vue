<script setup lang="ts">
type CapabilityStatus = 'existing' | 'critical-gap' | 'bounded-extension';

interface CapabilityNote {
	status: CapabilityStatus;
	label: string;
	detail: string;
}

interface Reconstruction {
	id: string;
	name: string;
	shortName: string;
	description: string;
	duration: string;
	items: string[];
	timeline: string[];
	capabilities: CapabilityNote[];
}

definePageMeta({
	title: 'Broadcast Graphics Fidelity Prototype',
	layout: false,
});

useHead({
	title: 'PROTOTYPE — Broadcast Graphics Fidelity',
});

const route = useRoute();
const router = useRouter();

const reconstructions: Reconstruction[] = [
	{
		id: 'split',
		name: 'Split angular commentator lower-third',
		shortName: 'Split lower-third',
		description: 'Two independent faceted nameplates with cyan accents and replaceable commentator names.',
		duration: '7.2 s loop',
		items: [
			'2 shape beds',
			'2 cyan accent rules',
			'2 text Graphic Items',
		],
		timeline: [
			'0.0 s — beds slide and reveal from the outside edges',
			'0.3 s — accent rules wipe on',
			'0.6 s — commentator names fade and rise',
			'5.7 s — names leave, followed by rules and beds',
		],
		capabilities: [
			{ status: 'existing', label: 'Positioned text and box styling', detail: 'Geometry, Graphic Layer Order, text styling, gradients, opacity, and one-sided borders already exist.' },
			{ status: 'critical-gap', label: 'Bounded angular geometry', detail: 'The angled outer ends need a shape or corner-cut preset; arbitrary path drawing is unnecessary.' },
			{ status: 'critical-gap', label: 'Enter and exit recipes', detail: 'The existing editor has no playout lifecycle animation for a Graphic Item or group.' },
		],
	},
	{
		id: 'strip',
		name: 'Full-width animated commentator lower-third',
		shortName: 'Full-width strip',
		description: 'A clipped animated bed, foreground rules, two names, and central show branding in a staged sequence.',
		duration: '8.5 s loop',
		items: [
			'1 clipped animated-media bed',
			'4 shape/rule Graphic Items',
			'2 text Graphic Items',
			'1 central brand Graphic Item',
		],
		timeline: [
			'0.0 s — rules wipe outward and bed reveals upward',
			'0.5 s — central brand scales in',
			'0.8 s — left and right names slide into place',
			'6.7 s — names and brand leave before the bed collapses',
		],
		capabilities: [
			{ status: 'existing', label: 'Layering and styled surfaces', detail: 'Ordered items, gradients, borders, text, images, and canvas groups cover the static composition.' },
			{ status: 'critical-gap', label: 'Item-scoped animated media', detail: 'Video currently fills the Feature Match Overlay Frame; this design needs media fitted and clipped inside one Graphic Item.' },
			{ status: 'critical-gap', label: 'Staged choreography', detail: 'A bounded recipe sequence needs per-item delay, duration, easing, and enter/exit order.' },
		],
	},
	{
		id: 'slate',
		name: 'Full-screen branded slate',
		shortName: 'Branded slate',
		description: 'A central brand mark, two partner marks, and a message entering and leaving in a coordinated sequence.',
		duration: '8.9 s loop',
		items: [
			'3 image Graphic Items',
			'1 text Graphic Item',
		],
		timeline: [
			'0.0 s — central mark fades and scales in',
			'0.5 s — partner marks follow from left and right',
			'0.9 s — message rises into place',
			'7.0 s — items fade and scale away in reverse groups',
		],
		capabilities: [
			{ status: 'existing', label: 'Images, text, and free placement', detail: 'The existing image and text widgets already cover the static item vocabulary.' },
			{ status: 'bounded-extension', label: 'Reusable scale/fade recipes', detail: 'Scale and fade with delays reproduce the motion character without keyframes.' },
			{ status: 'critical-gap', label: 'Whole-graphic lifecycle', detail: 'The composition needs an explicit enter, on-screen, and exit state owned by its Broadcast Graphic.' },
		],
	},
	{
		id: 'bug',
		name: 'Derived persistent brand bug',
		shortName: 'Persistent bug',
		description: 'A compact brand Graphic that enters once, remains on air, and leaves only when explicitly taken out.',
		duration: 'Operator-held',
		items: [
			'1 styled shape bed',
			'1 image/brand Graphic Item',
			'1 optional text Graphic Item',
		],
		timeline: [
			'TAKE — bug fades and slides from the upper-right',
			'ON SCREEN — no timer; remains until operator action',
			'TAKE OUT — short fade and slide to the upper-right',
		],
		capabilities: [
			{ status: 'existing', label: 'Static composition vocabulary', detail: 'A box, image, and text are already expressible with current styles.' },
			{ status: 'bounded-extension', label: 'Simple enter/exit recipe', detail: 'One slide/fade preset is sufficient for this case.' },
			{ status: 'critical-gap', label: 'Independent playout state', detail: 'The bug must be independently shown and held as its own Broadcast Graphic.' },
		],
	},
];

const requestedId = computed(() => typeof route.query.variant === 'string' ? route.query.variant : reconstructions[0]!.id);
const currentIndex = computed(() => {
	const index = reconstructions.findIndex(reconstruction => reconstruction.id === requestedId.value);
	return index >= 0 ? index : 0;
});
const current = computed(() => reconstructions[currentIndex.value]!);
const replayKey = ref(0);
const isPaused = ref(false);
const showStructure = ref(true);
const isSwitcherVisible = import.meta.dev;

const statusPresentation: Record<CapabilityStatus, { color: 'neutral' | 'warning' | 'error'; icon: string; label: string }> = {
	'existing': { color: 'neutral', icon: 'i-lucide-check', label: 'Existing base' },
	'bounded-extension': { color: 'warning', icon: 'i-lucide-plus', label: 'Bounded extension' },
	'critical-gap': { color: 'error', icon: 'i-lucide-triangle-alert', label: 'Fidelity-critical gap' },
};

watch(requestedId, () => {
	replayKey.value += 1;
	isPaused.value = false;
});

function choose(index: number) {
	const normalizedIndex = (index + reconstructions.length) % reconstructions.length;
	void router.replace({
		query: {
			...route.query,
			variant: reconstructions[normalizedIndex]!.id,
		},
	});
}

function replay() {
	replayKey.value += 1;
	isPaused.value = false;
}

function handleKeydown(event: KeyboardEvent) {
	const target = event.target as HTMLElement | null;
	if (target?.matches('input, textarea, [contenteditable="true"]'))
		return;

	if (event.key === 'ArrowLeft')
		choose(currentIndex.value - 1);
	if (event.key === 'ArrowRight')
		choose(currentIndex.value + 1);
	if (event.key.toLowerCase() === 'r')
		replay();
}

onMounted(() => window.addEventListener('keydown', handleKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown));
</script>

<template>
	<div class="prototype-shell">
		<header class="prototype-header">
			<div>
				<div class="prototype-kicker">
					<UBadge color="warning" variant="subtle" label="Throwaway prototype" />
					<span>Wayfinder fidelity test</span>
				</div>
				<h1>Can a constrained compositor reproduce the acceptance set?</h1>
				<p>
					A structured reconstruction using positioned Graphic Items, bounded style controls, and recipe-shaped motion.
				</p>
			</div>

			<div class="prototype-actions">
				<UButton
					:icon="isPaused ? 'i-lucide-play' : 'i-lucide-pause'"
					color="neutral"
					variant="outline"
					:label="isPaused ? 'Resume' : 'Pause'"
					@click="isPaused = !isPaused"
				/>
				<UButton icon="i-lucide-rotate-ccw" label="Replay" @click="replay" />
			</div>
		</header>

		<main class="prototype-main">
			<section class="stage-column" aria-label="Graphic reconstruction">
				<div class="stage-heading">
					<div>
						<p class="eyebrow">
							{{ current.name }}
						</p>
						<p>{{ current.description }}</p>
					</div>
					<div class="stage-options">
						<UBadge color="neutral" variant="subtle" :label="current.duration" />
						<label class="structure-toggle">
							<input v-model="showStructure" type="checkbox">
							Show item bounds
						</label>
					</div>
				</div>

				<div class="canvas-frame">
					<div
						:key="`${current.id}-${replayKey}`"
						class="broadcast-canvas"
						:class="[
							`broadcast-canvas--${current.id}`,
							{ 'is-paused': isPaused, 'show-structure': showStructure },
						]"
					>
						<div class="safe-area" />

						<template v-if="current.id === 'split'">
							<div class="split-plate split-plate--left graphic-item" data-item="Shape bed">
								<div class="split-facet" />
								<div class="split-accent" />
								<div class="split-name">
									RILEY KNIGHT
								</div>
							</div>
							<div class="split-plate split-plate--right graphic-item" data-item="Shape bed">
								<div class="split-facet" />
								<div class="split-accent" />
								<div class="split-name">
									MOLLY ROWE
								</div>
							</div>
						</template>

						<template v-else-if="current.id === 'strip'">
							<div class="strip-bed graphic-item" data-item="Clipped animated media">
								<div class="strip-media" />
								<div class="strip-grid" />
								<div class="strip-slashes" />
							</div>
							<div class="strip-rule strip-rule--top graphic-item" data-item="Shape rule" />
							<div class="strip-rule strip-rule--bottom graphic-item" data-item="Shape rule" />
							<div class="strip-name strip-name--left graphic-item" data-item="Text">
								IAN CORMICK
							</div>
							<div class="strip-brand graphic-item" data-item="Brand media">
								<span>MTG</span>
								<strong>BAZAAR</strong>
							</div>
							<div class="strip-name strip-name--right graphic-item" data-item="Text">
								DYLAN BROWN
							</div>
						</template>

						<template v-else-if="current.id === 'slate'">
							<div class="slate-aura" />
							<div class="slate-partner slate-partner--left graphic-item" data-item="Image">
								<span>PARTNER</span>
								<strong>ONE</strong>
							</div>
							<div class="slate-brand graphic-item" data-item="Image">
								<span>MTG</span>
								<strong>BAZAAR</strong>
							</div>
							<div class="slate-partner slate-partner--right graphic-item" data-item="Image">
								<span>PARTNER</span>
								<strong>TWO</strong>
							</div>
							<div class="slate-message graphic-item" data-item="Text">
								Thanks for watching!
							</div>
						</template>

						<template v-else>
							<div class="brand-bug graphic-item" data-item="Broadcast Graphic">
								<div class="brand-bug__mark">
									SK
								</div>
								<div class="brand-bug__copy">
									<strong>STREAM KEEPR</strong>
									<span>LIVE COVERAGE</span>
								</div>
							</div>
						</template>
					</div>
				</div>

				<UAlert
					color="warning"
					variant="subtle"
					icon="i-lucide-flask-conical"
					title="Fidelity, not asset matching"
					description="The original source fonts and media were unavailable to this prototype. Placeholder assets preserve hierarchy, geometry, motion character, and required editability."
				/>
			</section>

			<aside class="evidence-column" aria-label="Reconstruction evidence">
				<section>
					<h2>Graphic Item structure</h2>
					<ul class="plain-list">
						<li v-for="item in current.items" :key="item">
							<UIcon name="i-lucide-box" />
							{{ item }}
						</li>
					</ul>
				</section>

				<section>
					<h2>Recipe-shaped timeline</h2>
					<ol class="timeline-list">
						<li v-for="step in current.timeline" :key="step">
							{{ step }}
						</li>
					</ol>
				</section>

				<section>
					<h2>Capability reading</h2>
					<div class="capability-list">
						<article v-for="capability in current.capabilities" :key="capability.label" class="capability-note">
							<UBadge
								:color="statusPresentation[capability.status].color"
								:icon="statusPresentation[capability.status].icon"
								variant="subtle"
								:label="statusPresentation[capability.status].label"
							/>
							<h3>{{ capability.label }}</h3>
							<p>{{ capability.detail }}</p>
						</article>
					</div>
				</section>
			</aside>
		</main>

		<nav v-if="isSwitcherVisible" class="prototype-switcher" aria-label="Prototype reconstruction switcher">
			<UButton
				icon="i-lucide-arrow-left"
				color="neutral"
				variant="ghost"
				aria-label="Previous reconstruction"
				@click="choose(currentIndex - 1)"
			/>
			<div>
				<strong>{{ currentIndex + 1 }} / {{ reconstructions.length }}</strong>
				<span>{{ current.shortName }}</span>
			</div>
			<UButton
				icon="i-lucide-arrow-right"
				color="neutral"
				variant="ghost"
				aria-label="Next reconstruction"
				@click="choose(currentIndex + 1)"
			/>
		</nav>
	</div>
</template>

<style scoped>
.prototype-shell {
	background:
		radial-gradient(circle at 15% -10%, color-mix(in srgb, var(--ui-primary) 12%, transparent), transparent 32rem),
		var(--ui-bg);
	color: var(--ui-text);
	min-height: 100vh;
	padding: 2rem 2rem 7rem;
}

.prototype-header {
	align-items: flex-end;
	display: flex;
	gap: 2rem;
	justify-content: space-between;
	margin: 0 auto 2rem;
	max-width: 100rem;
}

.prototype-kicker,
.stage-options,
.prototype-actions {
	align-items: center;
	display: flex;
	gap: 0.75rem;
}

.prototype-kicker {
	color: var(--ui-text-muted);
	font-size: 0.78rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	margin-bottom: 0.8rem;
	text-transform: uppercase;
}

.prototype-header h1 {
	font-family: var(--font-display);
	font-size: clamp(2rem, 4vw, 4rem);
	font-weight: 800;
	letter-spacing: -0.025em;
	line-height: 0.95;
	max-width: 54rem;
	text-wrap: balance;
}

.prototype-header p {
	color: var(--ui-text-muted);
	margin-top: 0.8rem;
	max-width: 52rem;
}

.prototype-main {
	display: grid;
	gap: 2rem;
	grid-template-columns: minmax(0, 3fr) minmax(18rem, 1fr);
	margin: 0 auto;
	max-width: 100rem;
}

.stage-column,
.evidence-column {
	min-width: 0;
}

.stage-column {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.stage-heading {
	align-items: end;
	display: flex;
	gap: 1rem;
	justify-content: space-between;
}

.stage-heading .eyebrow {
	font-size: 1.15rem;
	font-weight: 800;
}

.stage-heading p:last-child {
	color: var(--ui-text-muted);
	font-size: 0.9rem;
	margin-top: 0.2rem;
}

.structure-toggle {
	align-items: center;
	color: var(--ui-text-muted);
	cursor: pointer;
	display: flex;
	font-size: 0.8rem;
	gap: 0.4rem;
}

.canvas-frame {
	background: var(--ui-bg-elevated);
	border: 1px solid var(--ui-border);
	border-radius: 0.8rem;
	box-shadow: var(--shadow-xl);
	overflow: hidden;
	padding: 0.6rem;
}

.broadcast-canvas {
	aspect-ratio: 16 / 9;
	background-color: #14131a;
	background-image:
		linear-gradient(45deg, rgba(255, 255, 255, 0.035) 25%, transparent 25%),
		linear-gradient(-45deg, rgba(255, 255, 255, 0.035) 25%, transparent 25%),
		linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.035) 75%),
		linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.035) 75%);
	background-position:
		0 0,
		0 1rem,
		1rem -1rem,
		-1rem 0;
	background-size: 2rem 2rem;
	contain: paint;
	overflow: hidden;
	position: relative;
	width: 100%;
}

.broadcast-canvas.is-paused *,
.broadcast-canvas.is-paused *::before,
.broadcast-canvas.is-paused *::after {
	animation-play-state: paused !important;
}

.safe-area {
	border: 1px dashed rgba(255, 255, 255, 0.12);
	inset: 5%;
	opacity: 0;
	pointer-events: none;
	position: absolute;
	transition: opacity 150ms ease;
}

.show-structure .safe-area {
	opacity: 1;
}

.graphic-item::after {
	background: rgba(3, 7, 18, 0.86);
	border: 1px solid rgba(255, 255, 255, 0.24);
	border-radius: 0.2rem;
	color: rgba(255, 255, 255, 0.9);
	content: attr(data-item);
	font-family: var(--font-mono);
	font-size: clamp(5px, 0.58vw, 10px);
	font-weight: 600;
	left: 0;
	opacity: 0;
	padding: 0.18rem 0.3rem;
	pointer-events: none;
	position: absolute;
	top: -1.3rem;
	transition: opacity 150ms ease;
	white-space: nowrap;
}

.show-structure .graphic-item {
	outline: 1px dashed rgba(255, 255, 255, 0.36);
	outline-offset: 2px;
}

.show-structure .graphic-item::after {
	opacity: 1;
}

/* Split lower-third: a bounded wedge preset supplies the only non-rectangular geometry. */
.split-plate {
	bottom: 7.5%;
	height: 10.5%;
	opacity: 0;
	position: absolute;
	width: 39%;
}

.split-plate--left {
	animation: split-left 7.2s cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
	clip-path: polygon(0 0, 94% 0, 100% 100%, 0 100%);
	left: 4.8%;
}

.split-plate--right {
	animation: split-right 7.2s cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
	clip-path: polygon(6% 0, 100% 0, 100% 100%, 0 100%);
	right: 4.8%;
}

.split-facet {
	background:
		linear-gradient(
			105deg,
			rgba(255, 255, 255, 0.035) 0 42%,
			transparent 42% 45%,
			rgba(0, 0, 0, 0.18) 45% 68%,
			transparent 68%
		),
		linear-gradient(90deg, rgba(8, 13, 18, 0.97), rgba(28, 39, 45, 0.9));
	box-shadow: inset 0 -0.35rem 1rem rgba(0, 0, 0, 0.45);
	inset: 0;
	position: absolute;
}

.split-accent {
	animation: accent-wipe 7.2s ease-in-out infinite;
	background: linear-gradient(90deg, #00d9ff, #65f4ff);
	height: 8%;
	left: 0;
	position: absolute;
	top: 0;
	transform-origin: left;
	width: 100%;
}

.split-plate--right .split-accent {
	transform-origin: right;
}

.split-name {
	align-items: center;
	animation: name-rise 7.2s ease-in-out infinite;
	color: #f8fbff;
	display: flex;
	font-family: var(--font-display);
	font-size: clamp(10px, 2.25vw, 42px);
	font-weight: 800;
	height: 100%;
	justify-content: center;
	letter-spacing: 0.06em;
	text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}

/* Full-width strip: animated media is clipped to one Graphic Item. */
.strip-bed {
	animation: bed-reveal 8.5s cubic-bezier(0.2, 0.85, 0.2, 1) infinite;
	bottom: 3.8%;
	height: 16.5%;
	left: 2.8%;
	overflow: hidden;
	position: absolute;
	transform-origin: center bottom;
	width: 94.4%;
}

.strip-media {
	animation: media-drift 4s ease-in-out infinite alternate;
	background:
		radial-gradient(circle at 64% 30%, rgba(255, 81, 199, 0.95), transparent 22%),
		radial-gradient(circle at 38% 90%, rgba(92, 38, 255, 0.95), transparent 28%),
		linear-gradient(112deg, #321048, #bd167f 48%, #431060);
	inset: -30%;
	position: absolute;
}

.strip-grid {
	background-image:
		linear-gradient(rgba(255, 255, 255, 0.11) 1px, transparent 1px),
		linear-gradient(90deg, rgba(255, 255, 255, 0.11) 1px, transparent 1px);
	background-size: 4.4% 34%;
	inset: 0;
	opacity: 0.45;
	position: absolute;
	transform: skewX(-12deg) scale(1.1);
}

.strip-slashes {
	background: repeating-linear-gradient(
		118deg,
		transparent 0 9%,
		rgba(255, 255, 255, 0.13) 9.2% 10%,
		transparent 10.2% 18%
	);
	inset: 0;
	position: absolute;
}

.strip-rule {
	animation: rule-wipe 8.5s ease-in-out infinite;
	background: rgba(255, 255, 255, 0.98);
	height: 0.45%;
	left: 2.8%;
	position: absolute;
	transform-origin: center;
	width: 94.4%;
}

.strip-rule--top {
	bottom: 20.3%;
}

.strip-rule--bottom {
	bottom: 3.4%;
}

.strip-name {
	align-items: center;
	animation: strip-name-in 8.5s cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
	bottom: 6.3%;
	color: #fff;
	display: flex;
	font-family: var(--font-display);
	font-size: clamp(10px, 2.05vw, 38px);
	font-weight: 900;
	height: 10.8%;
	letter-spacing: 0.055em;
	position: absolute;
	text-shadow: 0 2px 12px rgba(33, 5, 42, 0.75);
	width: 35%;
}

.strip-name--left {
	justify-content: flex-start;
	left: 7%;
}

.strip-name--right {
	animation-name: strip-name-in-right;
	justify-content: flex-end;
	right: 7%;
}

.strip-brand,
.slate-brand {
	align-items: center;
	color: #fff;
	display: flex;
	flex-direction: column;
	font-family: var(--font-display);
	justify-content: center;
	line-height: 0.78;
	position: absolute;
	text-shadow: 0 0 22px rgba(255, 90, 210, 0.52);
}

.strip-brand {
	animation: brand-pop 8.5s ease-in-out infinite;
	bottom: 5.4%;
	height: 13.4%;
	left: 42.5%;
	width: 15%;
}

.strip-brand span,
.slate-brand span {
	font-size: clamp(9px, 1.5vw, 30px);
	font-weight: 500;
	letter-spacing: 0.34em;
	margin-left: 0.34em;
}

.strip-brand strong,
.slate-brand strong {
	font-size: clamp(16px, 2.8vw, 54px);
	font-style: italic;
	font-weight: 900;
	letter-spacing: 0.08em;
}

/* Full-screen slate: four ordinary items plus shared lifecycle recipes. */
.broadcast-canvas--slate {
	background:
		radial-gradient(circle at center, rgba(176, 31, 142, 0.23), transparent 32%),
		linear-gradient(135deg, #130b1f, #050509 48%, #1d071d);
}

.slate-aura {
	animation: aura-pulse 3s ease-in-out infinite alternate;
	background: repeating-conic-gradient(from 15deg at center, rgba(255, 255, 255, 0.045) 0 2deg, transparent 2deg 10deg);
	inset: -30%;
	mask-image: radial-gradient(circle, #000 0, transparent 46%);
	position: absolute;
}

.slate-brand {
	animation: slate-brand-in 8.9s cubic-bezier(0.2, 0.75, 0.2, 1) infinite;
	height: 24%;
	left: 33%;
	top: 31%;
	width: 34%;
}

.slate-brand span {
	font-size: clamp(14px, 3vw, 58px);
}

.slate-brand strong {
	font-size: clamp(30px, 6.4vw, 124px);
}

.slate-partner {
	align-items: center;
	animation: partner-left-in 8.9s ease-in-out infinite;
	color: rgba(255, 255, 255, 0.88);
	display: flex;
	flex-direction: column;
	font-family: var(--font-display);
	height: 13%;
	justify-content: center;
	position: absolute;
	top: 37%;
	width: 15%;
}

.slate-partner--left {
	left: 11%;
}

.slate-partner--right {
	animation-name: partner-right-in;
	right: 11%;
}

.slate-partner span {
	font-size: clamp(6px, 0.8vw, 14px);
	letter-spacing: 0.28em;
}

.slate-partner strong {
	font-size: clamp(13px, 2.4vw, 46px);
	letter-spacing: 0.08em;
}

.slate-message {
	animation: message-rise 8.9s ease-in-out infinite;
	color: rgba(255, 255, 255, 0.9);
	font-family: var(--font-display);
	font-size: clamp(12px, 2.35vw, 46px);
	font-weight: 600;
	left: 25%;
	letter-spacing: 0.04em;
	position: absolute;
	text-align: center;
	top: 62%;
	width: 50%;
}

/* Persistent bug: the hold deliberately has no timed exit in the model. */
.brand-bug {
	align-items: center;
	animation: bug-take 1.1s cubic-bezier(0.2, 0.9, 0.25, 1) both;
	background: linear-gradient(115deg, rgba(15, 24, 30, 0.96), rgba(31, 13, 42, 0.94));
	border-left: 0.35rem solid #00d9ff;
	box-shadow: 0 0.7rem 2rem rgba(0, 0, 0, 0.42);
	clip-path: polygon(7% 0, 100% 0, 100% 100%, 0 100%, 0 26%);
	display: flex;
	gap: 5%;
	height: 11%;
	padding: 1.3% 2%;
	position: absolute;
	right: 4.8%;
	top: 7%;
	width: 24%;
}

.brand-bug__mark {
	align-items: center;
	background: linear-gradient(135deg, #00d9ff, #9d43ff);
	border-radius: 16%;
	color: #061017;
	display: flex;
	font-family: var(--font-display);
	font-size: clamp(12px, 2vw, 38px);
	font-weight: 900;
	height: 100%;
	justify-content: center;
	width: 23%;
}

.brand-bug__copy {
	display: flex;
	flex-direction: column;
	font-family: var(--font-display);
	justify-content: center;
	line-height: 1;
}

.brand-bug__copy strong {
	color: #fff;
	font-size: clamp(9px, 1.35vw, 26px);
	letter-spacing: 0.05em;
}

.brand-bug__copy span {
	color: #6eeaff;
	font-size: clamp(5px, 0.62vw, 12px);
	font-weight: 700;
	letter-spacing: 0.18em;
	margin-top: 8%;
}

.evidence-column {
	display: flex;
	flex-direction: column;
	gap: 1.8rem;
}

.evidence-column section {
	border-top: 1px solid var(--ui-border);
	padding-top: 1rem;
}

.evidence-column h2 {
	font-size: 0.82rem;
	font-weight: 800;
	letter-spacing: 0.08em;
	margin-bottom: 0.8rem;
	text-transform: uppercase;
}

.plain-list,
.timeline-list {
	color: var(--ui-text-muted);
	font-size: 0.85rem;
}

.plain-list {
	display: grid;
	gap: 0.5rem;
	list-style: none;
}

.plain-list li {
	align-items: center;
	display: flex;
	gap: 0.5rem;
}

.timeline-list {
	display: grid;
	gap: 0.55rem;
	list-style: decimal;
	padding-left: 1.2rem;
}

.capability-list {
	display: grid;
	gap: 1rem;
}

.capability-note h3 {
	font-size: 0.9rem;
	font-weight: 750;
	margin-top: 0.5rem;
}

.capability-note p {
	color: var(--ui-text-muted);
	font-size: 0.82rem;
	line-height: 1.5;
	margin-top: 0.25rem;
}

.prototype-switcher {
	align-items: center;
	background: color-mix(in srgb, var(--ui-bg-inverted) 94%, transparent);
	border: 1px solid color-mix(in srgb, var(--ui-border-inverted) 60%, transparent);
	border-radius: 999px;
	bottom: 1.5rem;
	box-shadow: var(--shadow-2xl);
	color: var(--ui-text-inverted);
	display: flex;
	gap: 0.35rem;
	left: 50%;
	padding: 0.35rem;
	position: fixed;
	transform: translateX(-50%);
	z-index: 100;
}

.prototype-switcher > div {
	align-items: center;
	display: flex;
	font-size: 0.78rem;
	gap: 0.5rem;
	justify-content: center;
	min-width: 11rem;
}

.prototype-switcher span {
	opacity: 0.72;
}

@keyframes split-left {
	0% {
		opacity: 0;
		transform: translateX(-120%);
	}
	8%,
	79% {
		opacity: 1;
		transform: translateX(0);
	}
	90%,
	100% {
		opacity: 0;
		transform: translateX(-120%);
	}
}

@keyframes split-right {
	0% {
		opacity: 0;
		transform: translateX(120%);
	}
	8%,
	79% {
		opacity: 1;
		transform: translateX(0);
	}
	90%,
	100% {
		opacity: 0;
		transform: translateX(120%);
	}
}

@keyframes accent-wipe {
	0%,
	5% {
		transform: scaleX(0);
	}
	12%,
	79% {
		transform: scaleX(1);
	}
	86%,
	100% {
		transform: scaleX(0);
	}
}

@keyframes name-rise {
	0%,
	8% {
		opacity: 0;
		transform: translateY(24%);
	}
	16%,
	75% {
		opacity: 1;
		transform: translateY(0);
	}
	82%,
	100% {
		opacity: 0;
		transform: translateY(24%);
	}
}

@keyframes bed-reveal {
	0%,
	3% {
		opacity: 0;
		transform: scaleY(0);
	}
	11%,
	79% {
		opacity: 1;
		transform: scaleY(1);
	}
	91%,
	100% {
		opacity: 0;
		transform: scaleY(0);
	}
}

@keyframes media-drift {
	from {
		transform: translate3d(-4%, -3%, 0) rotate(-2deg);
	}
	to {
		transform: translate3d(4%, 3%, 0) rotate(2deg);
	}
}

@keyframes rule-wipe {
	0% {
		opacity: 0;
		transform: scaleX(0);
	}
	8%,
	82% {
		opacity: 1;
		transform: scaleX(1);
	}
	94%,
	100% {
		opacity: 0;
		transform: scaleX(0);
	}
}

@keyframes strip-name-in {
	0%,
	8% {
		opacity: 0;
		transform: translateX(-30%);
	}
	18%,
	74% {
		opacity: 1;
		transform: translateX(0);
	}
	84%,
	100% {
		opacity: 0;
		transform: translateX(-30%);
	}
}

@keyframes strip-name-in-right {
	0%,
	8% {
		opacity: 0;
		transform: translateX(30%);
	}
	18%,
	74% {
		opacity: 1;
		transform: translateX(0);
	}
	84%,
	100% {
		opacity: 0;
		transform: translateX(30%);
	}
}

@keyframes brand-pop {
	0%,
	6% {
		opacity: 0;
		transform: scale(0.7);
	}
	14%,
	75% {
		opacity: 1;
		transform: scale(1);
	}
	83%,
	100% {
		opacity: 0;
		transform: scale(0.7);
	}
}

@keyframes aura-pulse {
	from {
		opacity: 0.4;
		transform: rotate(-2deg) scale(0.96);
	}
	to {
		opacity: 0.75;
		transform: rotate(2deg) scale(1.05);
	}
}

@keyframes slate-brand-in {
	0%,
	4% {
		opacity: 0;
		transform: scale(0.58);
	}
	14%,
	76% {
		opacity: 1;
		transform: scale(1);
	}
	88%,
	100% {
		opacity: 0;
		transform: scale(0.72);
	}
}

@keyframes partner-left-in {
	0%,
	9% {
		opacity: 0;
		transform: translateX(-28%) scale(0.86);
	}
	19%,
	72% {
		opacity: 1;
		transform: translateX(0) scale(1);
	}
	84%,
	100% {
		opacity: 0;
		transform: translateX(-10%) scale(0.9);
	}
}

@keyframes partner-right-in {
	0%,
	9% {
		opacity: 0;
		transform: translateX(28%) scale(0.86);
	}
	19%,
	72% {
		opacity: 1;
		transform: translateX(0) scale(1);
	}
	84%,
	100% {
		opacity: 0;
		transform: translateX(10%) scale(0.9);
	}
}

@keyframes message-rise {
	0%,
	13% {
		opacity: 0;
		transform: translateY(55%);
	}
	23%,
	70% {
		opacity: 1;
		transform: translateY(0);
	}
	81%,
	100% {
		opacity: 0;
		transform: translateY(25%);
	}
}

@keyframes bug-take {
	from {
		opacity: 0;
		transform: translateX(32%) scale(0.94);
	}
	to {
		opacity: 1;
		transform: translateX(0) scale(1);
	}
}

@media (max-width: 1050px) {
	.prototype-main {
		grid-template-columns: 1fr;
	}

	.evidence-column {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
	}
}

@media (max-width: 720px) {
	.prototype-shell {
		padding: 1rem 1rem 6rem;
	}

	.prototype-header,
	.stage-heading {
		align-items: flex-start;
		flex-direction: column;
	}

	.prototype-actions {
		width: 100%;
	}

	.evidence-column {
		grid-template-columns: 1fr;
	}

	.stage-options {
		justify-content: space-between;
		width: 100%;
	}
}

@media (prefers-reduced-motion: reduce) {
	.broadcast-canvas *,
	.broadcast-canvas *::before,
	.broadcast-canvas *::after {
		animation-delay: -1s !important;
		animation-duration: 1ms !important;
		animation-iteration-count: 1 !important;
	}
}
</style>
