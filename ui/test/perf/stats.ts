import { Over } from "./ceiling.ts";

export interface Measured {
	runs: number[];
	median: number;
	spread: number;
	[extra: string]: unknown;
}

export interface Unavailable {
	unavailable: string;
}

export interface OverBound {
	over: number;
	reason: string;
}

export type Metric = Measured | Unavailable | OverBound;

export const noResult = (reason: Error | undefined): Unavailable | OverBound =>
	reason instanceof Over
		? { over: reason.bound, reason: reason.message }
		: { unavailable: reason?.message ?? "no runs" };

export const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	return sorted.length % 2 === 1
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
};

const round = (value: number) => Math.round(value * 100) / 100;

export const summarise = (runs: number[], extra: object = {}): Measured => ({
	runs: runs.map(round),
	median: round(median(runs)),
	spread: round(Math.max(...runs) - Math.min(...runs)),
	...extra,
});

export const shortfall = (runs: unknown[]) => {
	const failed = runs.filter((run) => run instanceof Error);
	return failed.length === 0
		? null
		: {
				failedRuns: failed.length,
				overRuns: failed.filter((run) => run instanceof Over).length,
			};
};

export const metricOf = (
	runs: (number | Error)[],
	extra: object = {},
): Metric => {
	const taken = runs.filter((run): run is number => typeof run === "number");
	if (taken.length > 0)
		return summarise(taken, { ...extra, ...shortfall(runs) });
	return noResult(runs.find((run): run is Error => run instanceof Error));
};
