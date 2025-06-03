<script lang="ts" setup>
const adjusting = ref(true)
const running = ref(false)
const timeInput = ref('')
const isValid = ref(true)

// Validate time format and values
function validateTime(value: string, isAdjusting: boolean) {
  if (!value)
    return false

  if (isAdjusting) {
    // MM:SS format
    const mmssPattern = /^[0-5]?\d:[0-5]?\d$/
    if (!mmssPattern.test(value))
      return false

    const [minutes, seconds] = value.split(':').map(Number)
    if (minutes === undefined || seconds === undefined)
      return false

    return minutes <= 59 && seconds <= 59 && (minutes > 0 || seconds > 0)
  }
  else {
    // HH:MM:SS format
    const hhmmssPattern = /^[0-2]?\d:[0-5]?\d:[0-5]?\d$/
    if (!hhmmssPattern.test(value))
      return false

    const [hours, minutes, seconds] = value.split(':').map(Number)
    if (hours === undefined || minutes === undefined || seconds === undefined)
      return false
    return hours <= 23 && minutes <= 59 && seconds <= 59 && (hours > 0 || minutes > 0 || seconds > 0)
  }
}

// Clear input on focus
function handleFocus() {
  timeInput.value = ''
  isValid.value = true
}

// Smart time interpretation on blur
function formatTimeOnBlur() {
  if (!timeInput.value)
    return

  // Remove any extra characters and normalize
  const cleaned = timeInput.value.replace(/[^\d:]/g, '')

  // If it's already a properly formatted time, just format it
  if (cleaned.includes(':')) {
    const parts = cleaned.split(':')

    if (adjusting.value) {
      // MM:SS format
      if (parts.length === 2) {
        const minutes = Math.min(Number.parseInt(parts[0]!) || 0, 59)
        const seconds = Math.min(Number.parseInt(parts[1]!) || 0, 59)
        timeInput.value = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      }
    }
    else {
      // HH:MM:SS format
      if (parts.length === 3) {
        const hours = Math.min(Number.parseInt(parts[0]!) || 0, 23)
        const minutes = Math.min(Number.parseInt(parts[1]!) || 0, 59)
        const seconds = Math.min(Number.parseInt(parts[2]!) || 0, 59)
        timeInput.value = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      }
    }
  }
  else {
    // Interpret bare numbers intelligently
    const digits = cleaned
    const num = Number.parseInt(digits) || 0

    if (adjusting.value) {
      // MM:SS format interpretation
      if (digits.length === 1) {
        // Single digit: assume seconds (1 = 00:01)
        timeInput.value = `00:0${digits}`
      }
      else if (digits.length === 2) {
        if (num <= 59) {
          // Two digits 00-59: assume seconds (30 = 00:30)
          timeInput.value = `00:${digits}`
        }
        else {
          // Two digits 60-99: assume minutes (90 = 90:00, but cap at 59:00)
          const minutes = Math.min(num, 59)
          timeInput.value = `${minutes.toString().padStart(2, '0')}:00`
        }
      }
      else if (digits.length === 3) {
        // Three digits: assume MMM format, convert to MM:SS
        const totalSeconds = num
        const minutes = Math.min(Math.floor(totalSeconds / 60), 59)
        const seconds = Math.min(totalSeconds % 60, 59)
        timeInput.value = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      }
      else if (digits.length === 4) {
        // Four digits: assume MMSS format (1230 = 12:30)
        const minutes = Math.min(Number.parseInt(digits.slice(0, 2)), 59)
        const seconds = Math.min(Number.parseInt(digits.slice(2)), 59)
        timeInput.value = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      }
    }
    else {
      // HH:MM:SS format interpretation
      if (digits.length === 1) {
        // Single digit: assume seconds (5 = 00:00:05)
        timeInput.value = `00:00:0${digits}`
      }
      else if (digits.length === 2) {
        if (num <= 59) {
          // Two digits 00-59: assume seconds (30 = 00:00:30)
          timeInput.value = `00:00:${digits}`
        }
        else {
          // Two digits 60-99: assume minutes (90 = 00:90:00, but cap at 00:59:00)
          const minutes = Math.min(num, 59)
          timeInput.value = `00:${minutes.toString().padStart(2, '0')}:00`
        }
      }
      else if (digits.length === 3) {
        // Three digits: assume minutes and seconds (130 = 00:01:30)
        const totalSeconds = num
        const minutes = Math.min(Math.floor(totalSeconds / 60), 59)
        const seconds = Math.min(totalSeconds % 60, 59)
        timeInput.value = `00:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      }
      else if (digits.length === 4) {
        // Four digits: assume MMSS format (1230 = 00:12:30)
        const minutes = Math.min(Number.parseInt(digits.slice(0, 2)), 59)
        const seconds = Math.min(Number.parseInt(digits.slice(2)), 59)
        timeInput.value = `00:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      }
      else if (digits.length === 5) {
        // Five digits: assume HMMSS format (12345 = 01:23:45)
        const hours = Math.min(Number.parseInt(digits.slice(0, 1)), 9)
        const minutes = Math.min(Number.parseInt(digits.slice(1, 3)), 59)
        const seconds = Math.min(Number.parseInt(digits.slice(3)), 59)
        timeInput.value = `0${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      }
      else if (digits.length === 6) {
        // Six digits: assume HHMMSS format (123045 = 12:30:45)
        const hours = Math.min(Number.parseInt(digits.slice(0, 2)), 23)
        const minutes = Math.min(Number.parseInt(digits.slice(2, 4)), 59)
        const seconds = Math.min(Number.parseInt(digits.slice(4)), 59)
        timeInput.value = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      }
    }
  }

  // Update validation after formatting
  isValid.value = validateTime(timeInput.value, adjusting.value)
}

// Handle input with smart colon insertion and removal
function handleTimeInput(event: Event) {
  const target = event.target as HTMLInputElement
  let value = target.value

  // Allow only digits and colons
  value = value.replace(/[^\d:]/g, '')

  // Auto-remove trailing colons when there are no digits after them
  if (adjusting.value) {
    // MM:SS format
    // Remove colon if there are no digits after it
    if (value.endsWith(':') && value.length <= 3) {
      value = value.slice(0, -1)
    }
    // Remove colon if the pattern doesn't make sense (e.g., "12:" when user backspaced)
    if (value.includes(':') && !value.match(/^\d{1,2}:\d*$/)) {
      value = value.replace(':', '')
    }
  }
  else {
    // HH:MM:SS format
    // Remove trailing colons
    if (value.endsWith(':')) {
      // If it's the second colon and there's nothing after it, remove it
      if (value.split(':').length === 3 && value.length <= 6) {
        value = value.slice(0, -1)
      }
      // If it's the first colon and there's nothing after it, remove it
      else if (value.split(':').length === 2 && value.length <= 3) {
        value = value.slice(0, -1)
      }
    }

    // Clean up malformed patterns
    const parts = value.split(':')
    if (parts.length === 2 && parts[1] === '') {
      value = parts[0]! // Remove empty second part
    }
    if (parts.length === 3 && parts[2] === '' && parts[1] !== '') {
      value = `${parts[0]}:${parts[1]}` // Remove empty third part
    }
    if (parts.length === 3 && parts[2] === '' && parts[1] === '') {
      value = parts[0]! // Remove both empty parts
    }
  }

  // Smart colon insertion logic (only add, don't interfere with removal)
  if (adjusting.value) {
    // MM:SS format - auto-insert colon after 2 digits
    if (value.length === 3 && !value.includes(':') && /^\d{3}$/.test(value)) {
      value = `${value.slice(0, 2)}:${value.slice(2)}`
    }
  }
  else {
    // HH:MM:SS format - auto-insert colons after 2 and 5 characters
    if (value.length === 3 && !value.includes(':') && /^\d{3}$/.test(value)) {
      value = `${value.slice(0, 2)}:${value.slice(2)}`
    }
    else if (value.length === 6 && value.split(':').length === 2 && /^\d{2}:\d{3}$/.test(value)) {
      const parts = value.split(':')
      value = `${parts[0]}:${parts[1]!.slice(0, 2)}:${parts[1]!.slice(2)}`
    }
  }

  // Prevent too many colons
  const colonCount = (value.match(/:/g) || []).length
  const maxColons = adjusting.value ? 1 : 2

  if (colonCount > maxColons) {
    // Remove extra colons from the end
    const parts = value.split(':')
    value = parts.slice(0, maxColons + 1).join(':')
  }

  // Update the input
  timeInput.value = value
  target.value = value

  // Basic validation check
  isValid.value = value === '' || validateTime(value, adjusting.value)
}

// Simplified keydown handler - just prevent invalid characters
function handleKeydown(event: KeyboardEvent) {
  const key = event.key

  // Allow backspace, delete, tab, escape, enter, and arrow keys
  if ([8, 9, 27, 13, 37, 38, 39, 40, 46].includes(event.keyCode)) {
    return
  }

  // Allow Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
  if (event.ctrlKey || event.metaKey) {
    return
  }

  // Only allow digits and colons
  if (!/[\d:]/.test(key)) {
    event.preventDefault()
  }
}

const placeholder = computed(() => adjusting.value ? 'MM:SS' : 'HH:MM:SS')
const maxLength = computed(() => adjusting.value ? 5 : 8)

// Clear input when switching modes
watch(adjusting, () => {
  timeInput.value = ''
  isValid.value = true
})
</script>

<template>
  <UPopover>
    <UButton
      class="col-start-2 font-mono justify-center"
      color="neutral"
      variant="outline"
    >
      {{ '35:00' }}
    </UButton>
    <template #content>
      <div class="flex flex-col gap-4 p-4">
        <div class="flex gap-4 justify-between">
          <UButton
            v-if="adjusting"
            color="neutral"
            variant="subtle"
            icon="i-lucide-timer-reset"
            size="xl"
            @click="adjusting = false"
          />
          <UButton
            v-else
            color="neutral"
            variant="subtle"
            icon="i-lucide-alarm-clock"
            size="xl"
            @click="adjusting = true"
          />

          <UButton
            color="error"
            variant="subtle"
            icon="i-lucide-refresh-cw"
            size="xl"
            :disabled="running"
          />
          <UButton
            v-if="running"
            color="warning"
            variant="subtle"
            icon="i-lucide-pause"
            size="xl"
            @click="running = false"
          />
          <UButton
            v-else
            color="primary"
            variant="subtle"
            icon="i-lucide-play"
            size="xl"
            @click="running = true"
          />
        </div>
        <div class="flex items-center gap-4">
          <UButtonGroup v-if="adjusting" class="w-40" size="xl">
            <UButton
              color="neutral"
              variant="subtle"
              icon="i-lucide-clock-arrow-down"
            />
            <UInput
              v-model="timeInput"
              color="neutral"
              variant="outline"
              class="flex-1 font-mono"
              :ui="{ base: 'text-center' }"
              :placeholder="placeholder"
              :maxlength="maxLength"
              @focus="handleFocus"
              @input="handleTimeInput"
              @blur="formatTimeOnBlur"
              @keydown="handleKeydown"
            />
            <UButton
              color="neutral"
              variant="subtle"
              icon="i-lucide-clock-arrow-up"
            />
          </UButtonGroup>
          <UButtonGroup v-else class="w-40" size="xl">
            <UInput
              v-model="timeInput"
              color="neutral"
              variant="outline"
              class="flex-1 font-mono"
              :ui="{ base: 'text-center' }"
              :placeholder="placeholder"
              :maxlength="maxLength"
              @focus="handleFocus"
              @input="handleTimeInput"
              @blur="formatTimeOnBlur"
              @keydown="handleKeydown"
            />
            <UButton
              color="neutral"
              variant="subtle"
              :disabled="!isValid || !timeInput"
            >
              Set
            </UButton>
          </UButtonGroup>
        </div>
      </div>
    </template>
  </UPopover>
</template>
