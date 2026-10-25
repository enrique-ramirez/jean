import type { Page } from "@playwright/test";

export interface Answered {
	method: string;
	path: string;
	status: number;
	fakeMs: number | null;
}

export type Answers = Answered[];

export interface FakeTime {
	answers: number;
	ms: number;
	maxMs: number;
}

export interface FakeClock {
	start: () => number;
	stop: (from: number) => void;
}

export const FROM_RUN_START = 0;

const LIBRARY_ROWS = "/api/library/rows";
const PLAYLIST_ITEMS = /^\/api\/playlists\/[^/]+\/items$/;

export const isRowsRequest = ({ method, path }: Answered) =>
	(method === "POST" && path === LIBRARY_ROWS) ||
	(method === "GET" && PLAYLIST_ITEMS.test(path));

export const fakeTimeSince = (answers: Answers, from: number): FakeTime => {
	const timed = answers
		.slice(from)
		.flatMap((answer) => (answer.fakeMs === null ? [] : [answer.fakeMs]));
	return {
		answers: timed.length,
		ms: timed.reduce((sum, ms) => sum + ms, 0),
		maxMs: Math.max(0, ...timed),
	};
};

export function recordAnswers(page: Page, answers: Answers) {
	page.on("response", (response) => {
		const { pathname } = new URL(response.url());
		if (!pathname.startsWith("/api/")) return;
		const timing = /fake;dur=([\d.]+)/.exec(
			response.headers()["server-timing"] ?? "",
		);
		answers.push({
			method: response.request().method(),
			path: pathname,
			status: response.status(),
			fakeMs: timing ? Number(timing[1]) : null,
		});
	});
}
