import type { Volume } from "../api/types";
import { clamp } from "../ui/math";

// foobar2000 reports volume in decibels over -100..0, and the fader's job is to
// make that range feel like volume rather than like decibels. This one is
// linear in *perceived loudness*: about +10 dB is twice as loud, so mapping the
// fraction to `max + 10 * log2(f)` makes half the slider half as loud and a
// quarter of it a quarter as loud. Equal distances are equal *ratios* of
// loudness wherever they are taken from, which is the only promise a fader
// makes.
//
// Two other curves fail on a range reaching -100. Squaring the distance from
// the top puts most of the travel in silence rather than quietness, so the
// bottom third does nothing and the top third does everything. Linear in
// *amplitude* (`20 * log10(f)`, roughly macOS) fails the other way, cramming
// every quiet value into the bottom of the travel: it is the right law for a
// control whose floor is already near-silence, not one whose floor is -100.
const LOUDNESS_DOUBLING_DB = 10;

// Another player may report a plain linear range; `type` says which.
export function volumeToFraction(volume: Volume | null | undefined): number {
	if (!volume) return 0;
	const { type, min, max, value } = volume;

	if (type === "db")
		return clamp(2 ** ((value - max) / LOUDNESS_DOUBLING_DB), 0, 1);

	return clamp((value - min) / (max - min), 0, 1);
}

export function fractionToVolume(volume: Volume, fraction: number): number {
	const { type, min, max } = volume;
	const f = clamp(fraction, 0, 1);

	// `log2(0)` is -Infinity, which is the honest answer: the clamp turns it into
	// the player's own floor, so the bottom of the fader is silence rather than
	// merely very quiet. No branch needed.
	if (type === "db")
		return clamp(max + LOUDNESS_DOUBLING_DB * Math.log2(f), min, max);

	return min + (max - min) * f;
}

export const volumePercent = (volume: Volume | null | undefined) =>
	Math.round(volumeToFraction(volume) * 100);
