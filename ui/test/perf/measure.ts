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
	describePage,
	firstRowAt,
	installProbes,
	keystrokeMs,
	readProbes,
	resetProbes,
	searchCount,
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
	// Chromium's CPU throttle, a multiple of the machine's own speed.
	cpuThrottle: number | null;
}

export interface Target {
	origin: string;
	pages: Pages;
	// The fake's `/__control/` routes; a real player has none.
	hasControls: boolean;
}

export type Taken = number | Error;

export interface Task {
	stallMs: number;
	longTaskMs: number | null;
}

export interface RunResult {
	B1: Taken;
	B2: Task | Error;
	B3: (Task & { keystrokeMs: number }) | Error;
	B4: Record<"album" | "artist" | "genre", Taken>;
	B5: Taken;
	B6: Taken;
	B7: { ms: Taken; bytes: Taken };
	scrollEnd: ListEnd | Error;
}

// A cell not finished in its bound is recorded as over it. A load takes longer than a keystroke, so
// it has the longer bound; both are far past the slowest budget.
const LOAD_BOUND_MS = 120_000;
const CELL_BOUND_MS = 60_000;
const PAGE_ANSWER_MS = 5000;
export const CLOSE_MS = 15_000;
// After the work a metric names, the page is watched this long for the tasks it causes.
const SETTLE_MS = 2500;
const IDLE_BEFORE_HEAP_MS = 2000;
const ALBUM_TRACKS = 10;

// What the suite's fixtures seed, so the first-run dialogs do not stand between the page and its rows.
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

// An album and a genre draw their tracks; an artist opens on its discography, a row of album links.
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
	return page.evaluate(timeOpening, { hash, shown });
}

async function addedAlbum(page: Page, target: Target) {
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
		const ms = await shown;
		await page.waitForTimeout(500);
		page.off("requestfinished", counting);
		const total = (await Promise.all(bytes)).reduce(
			(sum, size) => sum + size,
			0,
		);

		// Put the library back, so the next run measures the same one.
		const restored = page.evaluate(timeRowCount, target.pages.trackCount);
		await control(target.origin, "library", { remove: ALBUM_TRACKS });
		await restored;
		return { ms, bytes: total };
	} finally {
		page.off("requestfinished", counting);
	}
}

export const unmeasured = (): RunResult => {
	const waiting = new Error("not measured yet");
	return {
		B1: waiting,
		B2: waiting,
		B3: waiting,
		B4: { album: waiting, artist: waiting, genre: waiting },
		B5: waiting,
		B6: waiting,
		B7: { ms: waiting, bytes: waiting },
		scrollEnd: waiting,
	};
};

// Fills `into` as each cell finishes and calls `saved` after each. Resolves with whether the page
// stopped answering, in which case the cells left are recorded as over their bound and the caller
// should not reuse the browser.
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

	// Measures one cell within its bound and stores the outcome, or `skipped` where the cell cannot
	// be taken at all. A cell over its bound ends the run if the page no longer answers.
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
		const B1 = await take(
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
		const loaded = typeof B1 === "number";
		const gate = loaded ? null : unloaded;

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
			"B6",
			LOAD_BOUND_MS,
			(taken) => {
				into.B6 = taken;
			},
			async () => {
				await page.reload({ waitUntil: "commit" });
				return rowsPainted(page);
			},
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
					into.B4[name] = taken;
				},
				() => openingPage(page, hash, shown),
				gate,
			);

		await take(
			"B7",
			CELL_BOUND_MS,
			(taken) => {
				into.B7 = taken instanceof Error ? { ms: taken, bytes: taken } : taken;
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
