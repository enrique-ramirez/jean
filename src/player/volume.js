const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

// foobar2000 reports volume in decibels over -100..0. Decibels are logarithmic
// and everything below roughly -40 dB is near-silent, so a linear fader would
// spend three quarters of its travel on values nobody wants. Squaring the
// normalised distance from the top puts most of the travel where the useful
// range is: half the slider lands around -25 dB, three quarters around -6 dB.
//
// Other players may report a plain linear range; `type` says which, so this
// stays correct on DeaDBeeF without a special case elsewhere.
const CURVE = 2

export function volumeToFraction(volume) {
  if (!volume) return 0
  const { type, min, max, value } = volume

  if (type === 'db') {
    const fromTop = clamp((value - max) / (min - max), 0, 1)
    return 1 - fromTop ** (1 / CURVE)
  }

  return clamp((value - min) / (max - min), 0, 1)
}

export function fractionToVolume(volume, fraction) {
  const { type, min, max } = volume
  const f = clamp(fraction, 0, 1)

  if (type === 'db') return max + (min - max) * (1 - f) ** CURVE

  return min + (max - min) * f
}

export const volumePercent = (volume) => Math.round(volumeToFraction(volume) * 100)
