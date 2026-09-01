const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

// foobar2000 reports volume in decibels over -100..0, and the fader's job is to
// make that range feel like volume rather than like decibels.
//
// The curve is linear in *perceived loudness*. About +10 dB is twice as loud --
// the sone scale's textbook figure, and the one thing about hearing that a
// volume control can be built on -- so mapping the fraction to
// `max + 10 * log2(f)` makes half the slider half as loud, a quarter of it a
// quarter as loud, and 70 to 80 exactly 14% more volume because it is 14% more
// slider. Equal distances anywhere on the fader are equal *ratios* of loudness,
// which is the whole of what a fader is asked to promise.
//
// It replaces squaring the distance from the top, which was this instinct
// applied far too hard. *Measured* on that curve: the midpoint was -25 dB, 15%
// was -72 dB -- silence, not quietness -- and everything below 30% was inaudible,
// so the bottom third of the travel did nothing and the top third did all of it.
// Ten points from 70 to 80 crossed 5 dB, close to twice the amplitude, while ten
// points from 10 to 20 crossed 17 dB of nothing at all.
//
// Linear in *amplitude* (`20 * log10(f)`, roughly what macOS does) was the other
// candidate. It fails the opposite way on a range that reaches -100: the
// midpoint lands at -6 dB, a hair under full, and every value below -26 dB is
// crammed into the bottom twentieth of the travel, so the fader has no quiet end
// to speak of. It is the right law for a control whose floor is already
// near-silence and the wrong one for a control whose floor is -100.
const LOUDNESS_DOUBLING_DB = 10

// Other players may report a plain linear range; `type` says which, so this
// stays correct on DeaDBeeF without a special case elsewhere.
export function volumeToFraction(volume) {
  if (!volume) return 0
  const { type, min, max, value } = volume

  if (type === 'db') return clamp(2 ** ((value - max) / LOUDNESS_DOUBLING_DB), 0, 1)

  return clamp((value - min) / (max - min), 0, 1)
}

export function fractionToVolume(volume, fraction) {
  const { type, min, max } = volume
  const f = clamp(fraction, 0, 1)

  // `log2(0)` is -Infinity, which is the honest answer and the one we want: the
  // clamp turns it into the player's own floor, so the bottom of the fader is
  // silence rather than merely very quiet. No branch needed for it.
  if (type === 'db') return clamp(max + LOUDNESS_DOUBLING_DB * Math.log2(f), min, max)

  return min + (max - min) * f
}

export const volumePercent = (volume) => Math.round(volumeToFraction(volume) * 100)
