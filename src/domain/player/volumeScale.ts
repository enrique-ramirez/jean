import type { Volume } from "@/shared/api/types";
import { clamp } from "@/shared/lib/math";

// Linear in perceived loudness: about +10 dB is twice as loud, so `max + 10 * log2(f)` makes equal distances on the fader equal ratios of loudness.
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

	// `log2(0)` is -Infinity, and the clamp turns that into the player's own floor, so the bottom of the fader is silence rather than merely very quiet.
	if (type === "db")
		return clamp(max + LOUDNESS_DOUBLING_DB * Math.log2(f), min, max);

	return min + (max - min) * f;
}

export const volumePercent = (volume: Volume | null | undefined) =>
	Math.round(volumeToFraction(volume) * 100);
