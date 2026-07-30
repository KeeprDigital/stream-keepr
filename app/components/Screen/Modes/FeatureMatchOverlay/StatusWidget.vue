<script setup lang="ts">
const props = withDefaults(defineProps<{
	lifeTotal?: number | string | null;
	animation?: 'none' | 'fade' | 'pop' | 'slide' | 'glow';
	durationMs?: number;
	accentColor?: string;
}>(), {
	animation: 'glow',
	durationMs: 420,
	accentColor: '#ffffff',
});

const animationKey = ref(0);
const hasMounted = ref(false);

watch(() => props.lifeTotal, (next, previous) => {
	if (!hasMounted.value) {
		hasMounted.value = true;
		return;
	}
	if (next !== previous && props.animation !== 'none')
		animationKey.value += 1;
});

const lifeClass = computed(() => props.animation !== 'none' ? `life-total--${props.animation}` : undefined);
const lifeStyle = computed(() => ({
	'--life-animation-duration': `${props.durationMs}ms`,
	'--life-animation-accent': props.accentColor,
}));
</script>

<template>
	<div class="status-graphicItem">
		<div
			:key="animationKey"
			class="life-total"
			:class="lifeClass"
			:style="lifeStyle"
		>
			{{ lifeTotal ?? '' }}
		</div>
	</div>
</template>

<style scoped>
.status-graphicItem {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 100%;
	position: relative;
}

.life-total {
	line-height: 1;
	will-change: transform, opacity, filter, text-shadow;
}

.life-total--fade {
	animation: life-fade var(--life-animation-duration, 420ms) ease-out both;
}

.life-total--pop {
	animation: life-pop var(--life-animation-duration, 420ms) cubic-bezier(0.2, 0.9, 0.2, 1) both;
}

.life-total--slide {
	animation: life-slide var(--life-animation-duration, 420ms) cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.life-total--glow {
	animation: life-glow var(--life-animation-duration, 420ms) ease-out both;
}

@keyframes life-fade {
	0% {
		opacity: 0.35;
	}
	100% {
		opacity: 1;
	}
}

@keyframes life-pop {
	0% {
		transform: scale(0.92);
		opacity: 0.75;
	}
	55% {
		transform: scale(1.08);
		opacity: 1;
	}
	100% {
		transform: scale(1);
		opacity: 1;
	}
}

@keyframes life-slide {
	0% {
		transform: translateY(0.18em);
		opacity: 0;
	}
	100% {
		transform: translateY(0);
		opacity: 1;
	}
}

@keyframes life-glow {
	0% {
		text-shadow: 0 0 0 transparent;
		filter: brightness(1);
	}
	35% {
		text-shadow: 0 0 0.35em var(--life-animation-accent, #fff);
		filter: brightness(1.25);
	}
	100% {
		text-shadow: 0 0 0 transparent;
		filter: brightness(1);
	}
}
</style>
