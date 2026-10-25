import type { Page } from "@playwright/test";

import { type Answers, isRowsRequest } from "./answers.ts";
import { scrollListToStart, scrollToStop } from "./scrollLimit.ts";

export const FLING_STOPS = ["fling", "25", "50", "75", "end"] as const;
export type FlingStop = (typeof FLING_STOPS)[number];

const STOP_FRACTION: Record<FlingStop, number | "fling"> = {
	fling: "fling",
	"25": 0.25,
	"50": 0.5,
	"75": 0.75,
	end: 1,
};

const LIST_AT_TOP_MS = 2500;
const REQUESTS_TAIL_MS = 250;

export interface Stopped {
	ms: number;
	rowsRequests: number;
	tooManyRequests: number;
}

export type Fling = Record<FlingStop, Stopped>;

export async function flingList(page: Page, answers: Answers): Promise<Fling> {
	await page.evaluate(scrollListToStart);
	await page.waitForTimeout(LIST_AT_TOP_MS);
	const stops: [FlingStop, Stopped][] = [];
	for (const stop of FLING_STOPS) {
		const from = answers.length;
		const ms = await page.evaluate(scrollToStop, STOP_FRACTION[stop]);
		await page.waitForTimeout(REQUESTS_TAIL_MS);
		const caused = answers.slice(from);
		stops.push([
			stop,
			{
				ms,
				rowsRequests: caused.filter(isRowsRequest).length,
				tooManyRequests: caused.filter((answer) => answer.status === 429)
					.length,
			},
		]);
	}
	return Object.fromEntries(stops) as Fling;
}
