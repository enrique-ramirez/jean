import { writeFile } from "node:fs/promises";

import type {
	Browser,
	BrowserContextOptions,
	CDPSession,
	Page,
	Request,
} from "@playwright/test";

import { Over, orElse, within } from "./ceiling.ts";
import type { Pages } from "./exportCost.ts";
import { postControl } from "./fakePlayer.ts";
import {
	armKeystroke,
	changesAfter,
	describePage,
	firstRowAt,
	installProbes,
	keystrokeMs,
	readProbes,
	readTimeline,
	resetProbes,
	searchCount,
	stateAnswers,
	timeOpening,
	timeRowCount,
} from "./pageProbes.ts";
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
}

export interface Target {
	origin: string;
	pages: Pages;
	hasControls: boolean;
}

export type Taken = number | Error;

export interface Task {
	stallMs: number;
	longTaskMs: number | null;
}

export const TIMELINE_MARKS = [
	"pagehideOfOldDocument",
	"navigationStart",
	"documentFirstByte",
	"domContentLoaded",
	"firstStateAsked",
	"restoreAsked",
	"restored",
	"exportRequested",
	"exportComplete",
	"firstRowInDom",
	"firstRowPainted",
	"lateComplete",
	"lateShown",
] as const;
export type TimelineMark = (typeof TIMELINE_MARKS)[number];

export interface Reload {
	// The page's clock: navigation start to the frame after the first row. Where the browser starts
	// that clock after the old document is gone, this leaves its teardown out.
	ms: number;
	waitedMs: number;
	timeline: Record<TimelineMark, number | null>;
	stallToFirstRowsMs: number;
	leavingMs: number | null;
	exportRequested: boolean;
	settled: Task;
}

export const RELOAD_KINDS = ["reload", "afterBlank", "cacheDisabled"] as const;
export type ReloadKind = (typeof RELOAD_KINDS)[number];

export interface Late {
	responseMs: number;
	shownMs: number;
}

export interface StoreWrite {
	stallMs: number;
	windowMs: number;
}

export interface Added {
	ms: Taken;
	sinceStateMovedMs: Taken;
	bytes: Taken;
	changesRequestedMs: Taken;
	changesCompleteMs: Taken;
	pollMs: Taken;
}

export interface RunResult {
	B1: Taken;
	landing: Task | Error;
	late: Late | Error;
	storeWrite: StoreWrite | Error;
	B2: Task | Error;
	B3: (Task & { keystrokeMs: number }) | Error;
	B4: Record<"album" | "artist" | "genre", Taken>;
	homeLanding: { cold: Task; reload: Task } | Error;
	B4Tasks: Record<"album" | "artist" | "genre", Task | Error>;
	B5: Taken;
	B6: Record<ReloadKind, Reload | Error>;
	B7: Added | Error;
	scrollEnd: ListEnd | Error;
}

const LOAD_BOUND_MS = 120_000;
const CELL_BOUND_MS = 60_000;
const PAGE_ANSWER_MS = 5000;
export const CLOSE_MS = 15_000;
const SETTLE_MS = 2500;
const IDLE_BEFORE_HEAP_MS = 2000;
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

async function openPage(browser: Browser, project: ProjectDefinition) {
	const context = await browser.newContext(project.options);
	await context.addInitScript((values: Record<string, unknown>) => {
		for (const [key, value] of Object.entries(values))
			localStorage.setItem(key, JSON.stringify(value));
	}, SEEDED_SETTINGS);
	await context.addInitScript(installProbes);
	const page = await context.newPage();
	page.setDefaultTimeout(0);

	let cdp: CDPSession | null = null;
	if (project.engine === "chromium") {
		cdp = await context.newCDPSession(page);
		if (project.cpuThrottle !== null)
			await cdp.send("Emulation.setCPUThrottlingRate", {
				rate: project.cpuThrottle,
			});
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
	const delta = page.waitForResponse(/\/api\/library\/changes/);
	const ordinal = target.pages.trackCount >> 1;
	return taskOf(
		await watched(page, async () => {
			await control(target.origin, "play", { ordinal });
			await delta;
		}),
	);
}

async function keystroke(page: Page, isPhone: boolean) {
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
	await page.keyboard.press("2");
	const timed = await page.evaluate(keystrokeMs);
	await page.waitForTimeout(SETTLE_MS);
	const tasks = taskOf(await page.evaluate(readProbes));
	await field.fill("");
	await field.press("Escape");
	return { ...tasks, keystrokeMs: timed };
}

const TRACK_ROWS = "[data-row]";
const DISCOGRAPHY = 'main a[href^="#/album/"]';

async function openingPage(page: Page, hash: string, shown: string) {
	await page.evaluate(() => {
		location.hash = "#/search";
	});
	await page.waitForFunction(
		(selector) => !document.querySelector(selector),
		shown,
	);
	await page.waitForTimeout(300);
	await page.evaluate(resetProbes);
	const ms = await page.evaluate(timeOpening, { hash, shown });
	await page.waitForTimeout(SETTLE_MS);
	return { ms, task: taskOf(await page.evaluate(readProbes)) };
}

const medianGap = (stamps: number[]) => {
	const gaps = stamps.slice(1).map((at, index) => at - stamps[index]);
	if (gaps.length === 0) return new Error("fewer than two state answers");
	gaps.sort((a, b) => a - b);
	return gaps[gaps.length >> 1];
};

async function addedAlbum(page: Page, target: Target): Promise<Added> {
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
		await control(target.origin, "library", { add: ALBUM_TRACKS });
		const { ms, sinceStateMovedMs, movedAt, began } = await shown;
		const changes = await page.evaluate(changesAfter, began);
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
			changesRequestedMs:
				changes && movedAt !== null
					? changes.start - movedAt
					: new Error("no request for the changes followed"),
			changesCompleteMs:
				changes && movedAt !== null
					? changes.end - movedAt
					: new Error("no request for the changes followed"),
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
): Promise<{ cold: Task; reload: Task }> {
	const { context, page } = await openPage(browser, project);
	try {
		await page.goto(`${origin}/#/`, { waitUntil: "commit" });
		await page.waitForSelector(HOME_SHELF);
		await page
			.waitForFunction(
				() =>
					performance
						.getEntriesByType("resource")
						.some(
							(entry) =>
								entry.name.includes("spine=false") &&
								(entry as PerformanceResourceTiming).responseEnd > 0,
						),
				null,
				{ timeout: LATE_PART_WAIT_MS },
			)
			.catch(() => undefined);
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

const BLANK_IDLE_MS = 1000;
// Firefox holds a navigation back for a while after a large page has loaded.
const DOCUMENT_AGE_MS = IDLE_BEFORE_HEAP_MS;
const LATE_PART_WAIT_MS = 10_000;

async function reloadTimed(
	page: Page,
	isReload: boolean,
	begin: () => Promise<unknown>,
	leavingMs: number | null = null,
): Promise<Reload> {
	const calledAt = Date.now();
	await begin();
	const ms = await rowsPainted(page);
	await page.waitForFunction(
		() =>
			(
				globalThis as unknown as {
					__perf: { marks: { lateShownAt: number | null } };
				}
			).__perf.marks.lateShownAt !== null,
	);
	await page.waitForTimeout(SETTLE_MS);
	const settled = taskOf(await page.evaluate(readProbes));
	const raw = (await page.evaluate(readTimeline)) as ReturnType<
		typeof readTimeline
	>;
	const since = (at: number | null) =>
		at === null ? null : raw.timeOrigin + at - calledAt;
	const timeline: Reload["timeline"] = {
		pagehideOfOldDocument:
			isReload && raw.pagehideEpoch !== null
				? raw.pagehideEpoch - calledAt
				: null,
		navigationStart: since(0),
		documentFirstByte: since(raw.responseStart),
		domContentLoaded: since(raw.domContentLoaded),
		firstStateAsked: since(raw.stateAsked),
		restoreAsked: since(raw.restoreAsked),
		restored: since(raw.restored),
		exportRequested: since(raw.firstExport?.start ?? null),
		exportComplete: since(raw.firstExport?.end ?? null),
		firstRowInDom: since(raw.rowInDom),
		firstRowPainted: since(raw.rowPainted),
		lateComplete: since(raw.lateExport?.end ?? null),
		lateShown: since(raw.lateShown),
	};
	return {
		ms,
		waitedMs: timeline.firstRowPainted as number,
		timeline,
		exportRequested: raw.firstExport !== null,
		stallToFirstRowsMs: raw.stallAtFirstRow as number,
		leavingMs,
		settled,
	};
}

async function agedDocument(page: Page, home: string) {
	await page.goto(home, { waitUntil: "commit" });
	await rowsPainted(page);
	await page.waitForTimeout(DOCUMENT_AGE_MS);
}

// What the HTTP cache holds is the thing varied: Chromium has a switch for it, and in the other
// engines Playwright turns the cache off while a route is installed.
async function withoutHttpCache<T>(
	page: Page,
	cdp: CDPSession | null,
	work: () => Promise<T>,
) {
	if (cdp) await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
	else await page.route("**/*", (route) => route.continue());
	try {
		return await work();
	} finally {
		if (cdp)
			await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
		else await page.unroute("**/*");
	}
}

export const unmeasured = (): RunResult => {
	const waiting = new Error("not measured yet");
	return {
		B1: waiting,
		landing: waiting,
		B2: waiting,
		B3: waiting,
		B4: { album: waiting, artist: waiting, genre: waiting },
		B4Tasks: { album: waiting, artist: waiting, genre: waiting },
		homeLanding: waiting,
		B5: waiting,
		late: waiting,
		storeWrite: waiting,
		B6: { reload: waiting, afterBlank: waiting, cacheDisabled: waiting },
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
	const { context, page, cdp } = await openPage(browser, project);
	const isPhone = project.options.isMobile === true;
	const noControls = new Error("the page's player has no /__control routes");
	const unloaded = new Error("the first rows never appeared");
	let stopped: string | null = null;

	const describe = () =>
		orElse(PAGE_ANSWER_MS, "the page did not answer when asked", () =>
			page.evaluate(describePage),
		);

	const take = async <T>(
		step: string,
		bound: number,
		store: (taken: T | Error) => void,
		work: () => Promise<T>,
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
			try {
				taken = await within(bound, describe, work);
			} catch (error) {
				taken = error instanceof Error ? error : new Error(String(error));
			}
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
			"late part",
			CELL_BOUND_MS,
			(taken) => {
				into.late = taken;
			},
			async (): Promise<Late> => {
				await page
					.waitForFunction(
						() =>
							performance
								.getEntriesByType("resource")
								.some(
									(entry) =>
										entry.name.includes("/library/export") &&
										entry.name.includes("spine=false") &&
										(entry as PerformanceResourceTiming).responseEnd > 0,
								),
						null,
						{ timeout: LATE_PART_WAIT_MS },
					)
					.catch(() => {
						throw new Error("no late part was requested");
					});
				const raw = await page.evaluate(readTimeline);
				if (raw.lateExport === null || raw.lateShown === null)
					throw new Error("no late part was requested");
				return {
					responseMs: raw.lateExport.end - (raw.rowPainted as number),
					shownMs: raw.lateShown - (raw.rowPainted as number),
				};
			},
			gate,
		);

		await take(
			"store write",
			CELL_BOUND_MS,
			(taken) => {
				into.storeWrite = taken;
			},
			async (): Promise<StoreWrite> => {
				await page.waitForFunction(
					() =>
						(
							globalThis as unknown as {
								__perf: {
									marks: { storeWindow: { closedAt: number | null } };
								};
							}
						).__perf.marks.storeWindow.closedAt !== null,
				);
				const { storeWindow } = await page.evaluate(readTimeline);
				return {
					stallMs: storeWindow.stallMs,
					windowMs:
						(storeWindow.closedAt as number) - (storeWindow.openedAt as number),
				};
			},
			gate,
		);

		await take(
			"landing",
			CELL_BOUND_MS,
			(taken) => {
				into.landing = taken;
			},
			async () => {
				await page.waitForTimeout(SETTLE_MS);
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

		const reloads: Record<ReloadKind, () => Promise<Reload>> = {
			reload: () =>
				reloadTimed(page, true, () => page.reload({ waitUntil: "commit" })),
			afterBlank: async () => {
				await agedDocument(page, home);
				const left = performance.now();
				await page.goto("about:blank");
				const leavingMs = performance.now() - left;
				await page.waitForTimeout(BLANK_IDLE_MS);
				return reloadTimed(
					page,
					false,
					() => page.goto(home, { waitUntil: "commit" }),
					leavingMs,
				);
			},
			cacheDisabled: async () => {
				await agedDocument(page, home);
				return withoutHttpCache(page, cdp, () =>
					reloadTimed(page, true, () => page.reload({ waitUntil: "commit" })),
				);
			},
		};
		for (const kind of RELOAD_KINDS)
			await take(
				kind === "reload" ? "B6" : `B6 ${kind}`,
				LOAD_BOUND_MS,
				(taken) => {
					into.B6[kind] = taken;
				},
				reloads[kind],
				gate,
			);

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
			() => keystroke(page, isPhone),
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
				() => openingPage(page, hash, shown),
				gate,
			);

		await take(
			"home landing",
			LOAD_BOUND_MS,
			(taken) => {
				into.homeLanding = taken;
			},
			() => homeLanding(browser, project, target.origin),
			gate,
		);

		await take(
			"B7",
			CELL_BOUND_MS,
			(taken) => {
				into.B7 = taken;
			},
			() => addedAlbum(page, target),
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
	const { context, page } = await openPage(browser, project);
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
