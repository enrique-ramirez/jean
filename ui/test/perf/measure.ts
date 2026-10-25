import { writeFile } from "node:fs/promises";

import type {
	Browser,
	BrowserContextOptions,
	CDPSession,
	Page,
	Request,
} from "@playwright/test";

import {
	type Answers,
	type FakeClock,
	type FakeTime,
	FROM_RUN_START,
	fakeTimeSince,
	recordAnswers,
} from "./answers.ts";
import { Over, orElse, within } from "./ceiling.ts";
import { postControl } from "./fakePlayer.ts";
import { type Fling, flingList } from "./fling.ts";
import {
	armKeystroke,
	describePage,
	firstRowAt,
	installProbes,
	keystrokeMs,
	readProbes,
	resetProbes,
	searchCount,
	stateAnswers,
	timeOpening,
	timeRowCount,
} from "./pageProbes.ts";
import type { Pages } from "./pages.ts";
import {
	honouredHeight,
	type ListEnd,
	scrollListToEnd,
	scrollListToStart,
} from "./scrollLimit.ts";

export interface ProjectDefinition {
	engine: "chromium" | "firefox" | "webkit";
	options: BrowserContextOptions;
	cpuThrottle: number | null;
	network: NetworkConditions | null;
}

export interface NetworkConditions {
	latencyMs: number;
	downBytesPerSecond: number;
	upBytesPerSecond: number;
}

export interface Target {
	origin: string;
	pages: Pages;
	hasControls: boolean;
	playlistHash: string | null;
}

export type Step =
	| "B1"
	| "landing"
	| "B5"
	| "list end"
	| "fling all"
	| "playlist"
	| "fling playlist"
	| "B2"
	| "B3"
	| `B4 ${"album" | "artist" | "genre"}`
	| "home landing"
	| "B7";

export type Taken = number | Error;

export interface Task {
	stallMs: number;
	longTaskMs: number | null;
}

export interface Added {
	ms: Taken;
	sinceStateMovedMs: Taken;
	bytes: Taken;
	pollMs: Taken;
}

export interface RunResult {
	fake: Partial<Record<Step, FakeTime>>;
	playlist: Taken;
	fling: { allMusic: Fling | Error; playlist: Fling | Error };
	B1: Taken;
	landing: Task | Error;
	B2: Task | Error;
	B3: (Task & { keystrokeMs: number }) | Error;
	B4: Record<"album" | "artist" | "genre", Taken>;
	homeLanding: { cold: Task; reload: Task } | Error;
	B4Tasks: Record<"album" | "artist" | "genre", Task | Error>;
	B5: Taken;
	B7: Added | Error;
	scrollEnd: ListEnd | Error;
}

const LOAD_BOUND_MS = 120_000;
const CELL_BOUND_MS = 60_000;
const PAGE_ANSWER_MS = 5000;
export const CLOSE_MS = 15_000;
const SETTLE_MS = 2500;
const IDLE_BEFORE_HEAP_MS = 2000;
// Firefox holds a navigation back for a while after a large page has loaded.
const DOCUMENT_AGE_MS = IDLE_BEFORE_HEAP_MS;
const ALBUM_TRACKS = 10;

const SEEDED_SETTINGS = {
	"jean.heatIntroSeen": true,
	"jean.settingsSeen": true,
	"jean.lowLatencyStream": false,
};

const control = async (origin: string, action: string, body: object) => {
	const answer = await postControl(origin, action, body);
	if (!answer.ok)
		throw new Error(`POST /__control/${action} answered ${answer.status}`);
};

async function openPage(
	browser: Browser,
	project: ProjectDefinition,
	answers: Answers,
) {
	const context = await browser.newContext(project.options);
	await context.addInitScript((values: Record<string, unknown>) => {
		for (const [key, value] of Object.entries(values))
			localStorage.setItem(key, JSON.stringify(value));
	}, SEEDED_SETTINGS);
	await context.addInitScript(installProbes);
	const page = await context.newPage();
	page.setDefaultTimeout(0);
	recordAnswers(page, answers);

	let cdp: CDPSession | null = null;
	if (project.engine === "chromium") {
		cdp = await context.newCDPSession(page);
		if (project.cpuThrottle !== null)
			await cdp.send("Emulation.setCPUThrottlingRate", {
				rate: project.cpuThrottle,
			});
		if (project.network !== null) {
			await cdp.send("Network.enable");
			await cdp.send("Network.emulateNetworkConditions", {
				offline: false,
				latency: project.network.latencyMs,
				downloadThroughput: project.network.downBytesPerSecond,
				uploadThroughput: project.network.upBytesPerSecond,
			});
		}
	}
	return { context, page, cdp };
}

const rowsPainted = async (page: Page) => {
	await page.waitForFunction(
		() =>
			(globalThis as unknown as { __perf: { firstRowAt: number | null } })
				.__perf.firstRowAt !== null,
	);
	return page.evaluate(firstRowAt) as Promise<number>;
};

async function heapMegabytes(cdp: CDPSession | null) {
	if (cdp === null) throw new Error("Runtime.getHeapUsage is Chromium's");
	await cdp.send("HeapProfiler.collectGarbage");
	const { usedSize } = await cdp.send("Runtime.getHeapUsage");
	return usedSize / 1e6;
}

const watched = async (page: Page, work: () => Promise<unknown>) => {
	await page.evaluate(resetProbes);
	await work();
	await page.waitForTimeout(SETTLE_MS);
	return page.evaluate(readProbes);
};

const taskOf = ({
	stallMs,
	longTaskMs,
}: {
	stallMs: number;
	longTaskMs: number | null;
}): Task => ({ stallMs, longTaskMs });

async function playCountDelta(page: Page, target: Target): Promise<Task> {
	const ordinal = target.pages.trackCount >> 1;
	return taskOf(
		await watched(page, async () => {
			await control(target.origin, "play", { ordinal });
		}),
	);
}

async function keystroke(page: Page, isPhone: boolean, clock: FakeClock) {
	const field = page.getByRole("combobox", { name: "Search your library" });
	if (!(await field.isVisible()))
		await page.getByRole("button", { name: "Search your library" }).click();
	await field.fill("Track 1");
	await page.waitForFunction(
		() =>
			document.querySelector("[data-pending]")?.getAttribute("data-pending") ===
			"false",
	);
	await page.waitForTimeout(isPhone ? SETTLE_MS : 500);

	const before = await page.evaluate(searchCount);
	await page.evaluate(resetProbes);
	await page.evaluate(armKeystroke, {
		query: "Track 12",
		countBefore: before,
	});
	const answersFrom = clock.start();
	await page.keyboard.press("2");
	const timed = await page.evaluate(keystrokeMs);
	clock.stop(answersFrom);
	await page.waitForTimeout(SETTLE_MS);
	const tasks = taskOf(await page.evaluate(readProbes));
	await field.fill("");
	await field.press("Escape");
	return { ...tasks, keystrokeMs: timed };
}

const TRACK_ROWS = "[data-row]";
const DISCOGRAPHY = 'main a[href^="#/album/"]';

async function openingPage(
	page: Page,
	hash: string,
	shown: string,
	clock: FakeClock,
) {
	await page.evaluate(() => {
		location.hash = "#/search";
	});
	await page.waitForFunction(
		(selector) => !document.querySelector(selector),
		shown,
	);
	await page.waitForTimeout(300);
	await page.evaluate(resetProbes);
	const answersFrom = clock.start();
	const ms = await page.evaluate(timeOpening, { hash, shown });
	clock.stop(answersFrom);
	await page.waitForTimeout(SETTLE_MS);
	return { ms, task: taskOf(await page.evaluate(readProbes)) };
}

const medianGap = (stamps: number[]) => {
	const gaps = stamps.slice(1).map((at, index) => at - stamps[index]);
	if (gaps.length === 0) return new Error("fewer than two state answers");
	gaps.sort((a, b) => a - b);
	return gaps[gaps.length >> 1];
};

async function addedAlbum(
	page: Page,
	target: Target,
	clock: FakeClock,
): Promise<Added> {
	const bytes: Promise<number>[] = [];
	const counting = (request: Request) => {
		bytes.push(
			request
				.sizes()
				.then((sizes) => sizes.responseBodySize + sizes.responseHeadersSize),
		);
	};

	await page.evaluate(() => {
		location.hash = "#/all";
	});
	await page.waitForSelector('[data-row="0"]');
	await page.waitForTimeout(500);

	page.on("requestfinished", counting);
	try {
		const shown = page.evaluate(
			timeRowCount,
			target.pages.trackCount + ALBUM_TRACKS,
		);
		const answersFrom = clock.start();
		await control(target.origin, "library", { add: ALBUM_TRACKS });
		const { ms, sinceStateMovedMs } = await shown;
		clock.stop(answersFrom);
		await page.waitForTimeout(500);
		page.off("requestfinished", counting);
		const total = (await Promise.all(bytes)).reduce(
			(sum, size) => sum + size,
			0,
		);
		const answers = await page.evaluate(stateAnswers);

		const restored = page.evaluate(timeRowCount, target.pages.trackCount);
		await control(target.origin, "library", { remove: ALBUM_TRACKS });
		await restored;
		return {
			ms,
			sinceStateMovedMs:
				sinceStateMovedMs ?? new Error("no state answer moved the structure"),
			bytes: total,
			pollMs: medianGap(answers.map((answer) => answer.at)),
		};
	} finally {
		page.off("requestfinished", counting);
	}
}

const HOME_SHELF =
	'section[aria-labelledby^="shelf-"], section[aria-labelledby="home-explore"]';

async function homeLanding(
	browser: Browser,
	project: ProjectDefinition,
	origin: string,
	answers: Answers,
): Promise<{ cold: Task; reload: Task }> {
	const { context, page } = await openPage(browser, project, answers);
	try {
		await page.goto(`${origin}/#/`, { waitUntil: "commit" });
		await page.waitForSelector(HOME_SHELF);
		await page.waitForTimeout(SETTLE_MS);
		const cold = taskOf(await page.evaluate(readProbes));

		await page.reload({ waitUntil: "commit" });
		await page.waitForSelector(HOME_SHELF);
		await page.waitForTimeout(SETTLE_MS);
		return { cold, reload: taskOf(await page.evaluate(readProbes)) };
	} finally {
		await orElse(CLOSE_MS, undefined, () => context.close());
	}
}

export const unmeasured = (): RunResult => {
	const waiting = new Error("not measured yet");
	return {
		fake: {},
		playlist: waiting,
		fling: { allMusic: waiting, playlist: waiting },
		B1: waiting,
		landing: waiting,
		B2: waiting,
		B3: waiting,
		B4: { album: waiting, artist: waiting, genre: waiting },
		B4Tasks: { album: waiting, artist: waiting, genre: waiting },
		homeLanding: waiting,
		B5: waiting,
		B7: waiting,
		scrollEnd: waiting,
	};
};

export async function measureRun(
	browser: Browser,
	project: ProjectDefinition,
	target: Target,
	options: { tracePath: string | null; scrollEnd: boolean },
	into: RunResult,
	saved: () => void,
): Promise<{ pageStopped: boolean }> {
	const answers: Answers = [];
	const { context, page, cdp } = await openPage(browser, project, answers);
	const isPhone = project.options.isMobile === true;
	const noControls = new Error("the page's player has no /__control routes");
	const unloaded = new Error("the first rows never appeared");
	const notLoaded = new Error("the playlist did not load");
	let stopped: string | null = null;

	const describe = () =>
		orElse(PAGE_ANSWER_MS, "the page did not answer when asked", () =>
			page.evaluate(describePage),
		);

	const take = async <T>(
		step: Step,
		bound: number,
		store: (taken: T | Error) => void,
		work: (clock: FakeClock) => Promise<T>,
		skipped: Error | null = null,
	) => {
		let taken: T | Error;
		if (stopped !== null) {
			taken = new Over(
				bound,
				`skipped; the page stopped answering in ${stopped}`,
			);
		} else if (skipped !== null) {
			taken = skipped;
		} else {
			process.stderr.write(`    ${step}\n`);
			const began = performance.now();
			const answeredFrom = answers.length;
			let windowed = false;
			const clock: FakeClock = {
				start: () => answers.length,
				stop: (from) => {
					windowed = true;
					into.fake[step] = fakeTimeSince(answers, from);
				},
			};
			try {
				taken = await within(bound, describe, () => work(clock));
			} catch (error) {
				taken = error instanceof Error ? error : new Error(String(error));
			}
			if (!windowed) into.fake[step] = fakeTimeSince(answers, answeredFrom);
			process.stderr.write(
				`    ${step} ${taken instanceof Error ? `failed: ${taken.message}` : "took"} (${Math.round(performance.now() - began)} ms)\n`,
			);
			if (taken instanceof Over) {
				const answers = await orElse(PAGE_ANSWER_MS, false, async () => {
					await page.evaluate(() => 1);
					return true;
				});
				if (!answers) stopped = step;
			}
		}
		store(taken);
		saved();
		return taken;
	};

	try {
		const home = `${target.origin}/#/all`;
		const firstRows = await take(
			"B1",
			LOAD_BOUND_MS,
			(taken) => {
				into.B1 = taken;
			},
			async () => {
				await page.goto(home, { waitUntil: "commit" });
				return rowsPainted(page);
			},
		);
		const loaded = typeof firstRows === "number";
		const gate = loaded ? null : unloaded;

		await take(
			"landing",
			CELL_BOUND_MS,
			(taken) => {
				into.landing = taken;
			},
			async (clock: FakeClock) => {
				await page.waitForTimeout(SETTLE_MS);
				clock.stop(FROM_RUN_START);
				return taskOf(await page.evaluate(readProbes));
			},
			gate,
		);

		await orElse(IDLE_BEFORE_HEAP_MS + PAGE_ANSWER_MS, undefined, () =>
			page.waitForTimeout(IDLE_BEFORE_HEAP_MS),
		);
		await take(
			"B5",
			CELL_BOUND_MS,
			(taken) => {
				into.B5 = taken;
			},
			() => heapMegabytes(cdp),
			gate,
		);

		if (options.scrollEnd) {
			const end = await take(
				"list end",
				CELL_BOUND_MS,
				(taken) => {
					into.scrollEnd = taken;
				},
				async () => {
					const end = await page.evaluate(scrollListToEnd);
					if (end === null)
						throw new Error("the track list was not on the page");
					return end;
				},
				gate,
			);
			if (!(end instanceof Error))
				await orElse(PAGE_ANSWER_MS, undefined, () =>
					page.evaluate(scrollListToStart),
				);
		}

		await take(
			"fling all",
			LOAD_BOUND_MS,
			(taken) => {
				into.fling.allMusic = taken;
			},
			() => flingList(page, answers),
			gate,
		);

		const { playlistHash } = target;
		const playlistGate =
			playlistHash === null
				? new Error("no playlist of the whole library could be made")
				: gate;
		await take(
			"playlist",
			LOAD_BOUND_MS,
			(taken) => {
				into.playlist = taken;
			},
			async () => {
				await page.goto("about:blank");
				await page.goto(`${target.origin}/${playlistHash}`, {
					waitUntil: "commit",
				});
				return rowsPainted(page);
			},
			playlistGate,
		);
		const playlistLoaded = typeof into.playlist === "number";
		await take(
			"fling playlist",
			LOAD_BOUND_MS,
			(taken) => {
				into.fling.playlist = taken;
			},
			() => flingList(page, answers),
			playlistLoaded ? null : (playlistGate ?? notLoaded),
		);

		if (stopped === null)
			await orElse(LOAD_BOUND_MS, undefined, async () => {
				await page.goto("about:blank");
				await page.goto(home, { waitUntil: "commit" });
				await rowsPainted(page);
				await page.waitForTimeout(DOCUMENT_AGE_MS + SETTLE_MS);
			});

		const { tracePath } = options;
		const traced = tracePath !== null && project.engine === "chromium";
		if (traced)
			await browser.startTracing(page, { categories: ["devtools.timeline"] });

		const controlsGate = gate ?? (target.hasControls ? null : noControls);
		await take(
			"B2",
			CELL_BOUND_MS,
			(taken) => {
				into.B2 = taken;
			},
			() => playCountDelta(page, target),
			controlsGate,
		);
		await take(
			"B3",
			CELL_BOUND_MS,
			(taken) => {
				into.B3 = taken;
			},
			(clock: FakeClock) => keystroke(page, isPhone, clock),
			gate,
		);

		if (traced && tracePath !== null) {
			const trace = await orElse(CLOSE_MS, null, () => browser.stopTracing());
			if (trace !== null) await writeFile(tracePath, trace);
		}

		for (const [name, hash, shown] of [
			["album", target.pages.album, TRACK_ROWS],
			["artist", target.pages.artist, DISCOGRAPHY],
			["genre", target.pages.genre, TRACK_ROWS],
		] as const)
			await take(
				`B4 ${name}`,
				CELL_BOUND_MS,
				(taken) => {
					if (taken instanceof Error) {
						into.B4[name] = taken;
						into.B4Tasks[name] = taken;
					} else {
						into.B4[name] = taken.ms;
						into.B4Tasks[name] = taken.task;
					}
				},
				(clock: FakeClock) => openingPage(page, hash, shown, clock),
				gate,
			);

		await take(
			"home landing",
			LOAD_BOUND_MS,
			(taken) => {
				into.homeLanding = taken;
			},
			() => homeLanding(browser, project, target.origin, answers),
			gate,
		);

		await take(
			"B7",
			CELL_BOUND_MS,
			(taken) => {
				into.B7 = taken;
			},
			(clock: FakeClock) => addedAlbum(page, target, clock),
			controlsGate,
		);

		return { pageStopped: stopped !== null };
	} finally {
		await orElse(CLOSE_MS, undefined, () => context.close());
	}
}

export async function honouredHeightOf(
	browser: Browser,
	project: ProjectDefinition,
) {
	const { context, page } = await openPage(browser, project, []);
	try {
		await page.goto("about:blank");
		return await within(
			CELL_BOUND_MS,
			async () => "the browser did not answer",
			() => page.evaluate(honouredHeight),
		);
	} finally {
		await orElse(CLOSE_MS, undefined, () => context.close());
	}
}
