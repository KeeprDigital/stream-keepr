<script setup lang="ts">
type Emits = {
  (e: 'previewBack', value: boolean): void
}

const emit = defineEmits<Emits>()

const previewing = ref(false)
const previewingTimeout = ref<NodeJS.Timeout | null>(null)

watch(previewing, (value) => {
  emit('previewBack', value)
})

function previewBack() {
  if (previewing.value && previewingTimeout.value) {
    previewing.value = false
    clearTimeout(previewingTimeout.value)
  }
  else {
    previewing.value = true

    previewingTimeout.value = setTimeout(() => {
      previewing.value = false
    }, 2000)
  }
}
</script>

<template>
  <button
    class="turnover-button"
    :class="{ previewing }"
    @click.stop="previewBack"
  >
    <svg
      focusable="false"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
    >
      <path d="M884.3,357.6c116.8,117.7,151.7,277-362.2,320V496.4L243.2,763.8L522,1031.3V860.8C828.8,839.4,1244.9,604.5,884.3,357.6z" />
      <path d="M557.8,288.2v138.4l230.8-213.4L557.8,0v142.8c-309.2,15.6-792.1,253.6-426.5,503.8C13.6,527.9,30,330.1,557.8,288.2z" />
    </svg>
  </button>
</template>

<style scoped>
.turnover-button {
  position: absolute;
  opacity: 0.6;
  background: white;
  border-radius: 100%;
  border: 2px solid #343242;
  display: block;
  height: 44px;
  width: 44px;
  padding: 7px;
  cursor: pointer;
  top: 26%;
  left: 75%;
  transform-style: flat;
  transition:
    background-color 200ms linear,
    opacity 50ms linear;
  z-index: 1000;
  transform: translateZ(0.01px);

  svg {
    fill: #343242;
    transition: fill 200ms linear;
  }

  &.is-flipped {
    border-color: #fff;
    background-color: #343242;

    svg {
      fill: #fff;
    }
  }

  &.previewing {
    border-color: #fff;
    background-color: #343242;

    svg {
      fill: #fff;
    }
  }

  &:hover {
    opacity: 1;
  }
}
</style>
