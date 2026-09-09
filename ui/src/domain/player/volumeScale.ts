import type { Volume } from "@/shared/api/types";
import { clamp } from "@/shared/lib/math";

const LOUDNESS_DOUBLING_DB = 10;

const loudness = (db: number, max: number) =>
	2 ** ((db - max) / LOUDNESS_DOUBLING_DB);

const floorOf = (volume: Volume) => loudness(volume.min, volume.max);

export function volumeToFraction(volume: Volume | null | undefined): number {
	if (!volume) return 0;
	const { type, min, max, value } = volume;

	if (type !== "db") return clamp((value - min) / (max - min), 0, 1);

	const floor = floorOf(volume);
	if (floor >= 1) return 0;

	return clamp((loudness(value, max) - floor) / (1 - floor), 0, 1);
}

export function fractionToVolume(volume: Volume, fraction: number): number {
	const { type, min, max } = volume;
	const f = clamp(fraction, 0, 1);

	if (type !== "db") return min + (max - min) * f;

	const floor = floorOf(volume);
	if (floor >= 1) return min;

	return clamp(
		max + LOUDNESS_DOUBLING_DB * Math.log2(floor + f * (1 - floor)),
		min,
		max,
	);
}

export const volumePercent = (volume: Volume | null | undefined) =>
	Math.round(volumeToFraction(volume) * 100);
