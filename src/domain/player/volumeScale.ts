import type { Volume } from "@/shared/api/types";
import { clamp } from "@/shared/lib/math";

// Linear in perceived loudness: about +10 dB is twice as loud, so `max + 10 * log2(f)` makes equal distances on the fader equal ratios of loudness. beefweb's own client uses the same law.
const LOUDNESS_DOUBLING_DB = 10;

const loudness = (db: number, max: number) =>
	2 ** ((db - max) / LOUDNESS_DOUBLING_DB);

// The curve approaches zero without reaching it, so the bottom of the fader has to be the player's own floor rather than a level the thumb can never arrive at. Which floor that is differs by player; see `CLAUDE.md`.
const floorOf = (volume: Volume) => loudness(volume.min, volume.max);

export function volumeToFraction(volume: Volume | null | undefined): number {
	if (!volume) return 0;
	const { type, min, max, value } = volume;

	if (type !== "db") return clamp((value - min) / (max - min), 0, 1);

	const floor = floorOf(volume);
	// A player reporting min === max has no travel to describe, and the span below would be zero.
	if (floor >= 1) return 0;

	return clamp((loudness(value, max) - floor) / (1 - floor), 0, 1);
}

export function fractionToVolume(volume: Volume, fraction: number): number {
	const { type, min, max } = volume;
	const f = clamp(fraction, 0, 1);

	if (type !== "db") return min + (max - min) * f;

	const floor = floorOf(volume);
	if (floor >= 1) return min;

	// `log2(0)` is -Infinity, which the floor is what keeps this away from: the bottom of the fader is the player's own silence rather than negative infinity clamped back up to it.
	return clamp(
		max + LOUDNESS_DOUBLING_DB * Math.log2(floor + f * (1 - floor)),
		min,
		max,
	);
}

export const volumePercent = (volume: Volume | null | undefined) =>
	Math.round(volumeToFraction(volume) * 100);
