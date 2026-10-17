// `pnpm perf` measures seven costs of a large library, B1 to B7, and writes one JSON report,
// `report-<timestamp>.json`, to the gitignored `OUT_DIR`. It drives the `playwright` browsers
// directly, so it reads no project from `playwright.config.ts`.
//
//   pnpm perf --tracks 37000                        a fake of that size, on a free port, in its own process
//   pnpm perf --tracks 37000,400000 --runs 5        several sizes, one fake each
//   pnpm perf --tracks 37000 --projects desktop     desktop, mobile, iphone and firefox are the projects
//   pnpm perf --url https://player.example          a player already serving Jean
//   pnpm perf --tracks 37000 --trace                also a Chromium timeline of B2 and B3 from the first run
//   pnpm perf --tracks 400000 --dist /path/to/page  a page built earlier, in place of one built from the tree
//
// The page is built once into `dist` under `OUT_DIR` and served by the fake beside its API. The fake
// runs without its export ceiling, and each size reports `aboveCeiling` where its export is over the
// component's, since a number taken there is not one the component could serve. Against a player, B2
// and B7 are unavailable: they need the fake's `/__control/` routes. The report is rewritten after
// every cell, so a killed run keeps what it measured. A cell not finished in its bound (two minutes
// for a load, one for the rest) is recorded as `{ over, reason }`; if the page then stops answering,
// the cells left in that run are recorded the same way and the next run starts in a fresh browser.
// Each project runs its cells `--runs` times (three by default) in a fresh context and reports
// `{ runs, median, spread }`, the spread being the largest run minus the smallest. `mobile` is Pixel 7
// emulation under Chromium's 4x CPU throttle; `iphone` is Playwright's WebKit with the iPhone 15
// descriptor and cannot be throttled; `firefox` is the desktop descriptor.
//
// What each cell is:
//   B1  the cold load to the first rows of All Music.
//   B2  a play-count delta. B2 and B3 report the longest gap between two turns of a zero-delay timer,
//       the one measure every engine has; Chromium's `longtask` observer sits beside it as
//       `longestLongTask`, which reports nothing under 50 ms, and Firefox and WebKit have none.
//   B3  a keystroke in search.
//   B4  opening an album, an artist or a genre. `B4.task` is the longest timer gap from the click
//       until its rows have painted and the page has been left to itself, the slowest of the three
//       in each run; each page's own is beside it.
//   B5  the JavaScript heap once idle: `Runtime.getHeapUsage` after a forced collection, which is
//       Chromium's alone and does not count the memory behind typed arrays.
//   B6  a reload, taken three ways: `B6`; `afterBlank`, after the tab sat on `about:blank` for a
//       second, which leaves the old document's teardown out of the clock; and `cacheDisabled`
//       (Chromium's `Network.setCacheDisabled`, a Playwright route in the other engines). The last
//       two start from a document loaded afresh and left for two seconds, as old as the one the
//       first reloads, since Firefox holds a navigation back for some seconds after a large page
//       loads. Each reports the page's clock (`ms`), the clock outside the page from the call to
//       the same frame (`waited`), and a `timeline` of where the navigation was: `pagehide`,
//       navigation start, first byte, `DOMContentLoaded`, the first `GET /api/state` asked, the
//       search worker asked to restore the stored library and its answer reaching the page, the full
//       export requested and complete (absent where the stored copy was drawn), the first row in the
//       DOM and painted, and the late part complete and shown. `afterBlank` also reports `leaving`,
//       how long `goto("about:blank")` took. The worker's two moments are stamped by wrapping
//       `Worker` in the page and the page's `fetch` is wrapped to read state answers; neither
//       changes what Jean does.
//   B7  one album added. `ms` runs from the control request and includes the player's own settle at
//       the next state poll; `sinceStateMoved` runs from the first state answer whose `structure`
//       moved to the added rows painted, which is what a person waits once the change is visible to
//       a client. `changesRequested` and `changesComplete` place the changes request against that
//       answer, and `pollMs` is the median gap between state answers. Its bytes are every response
//       finished until the list shows the album, state polls included.
//   landing  the longest timer gap from the cold load's navigation start until the library has
//       settled (the late part shown, the page left to itself), so it holds every task of the load
//       and is held to B2's budget. `B6.landing` is the same window for a reload drawing the stored
//       copy. `home` is the same window for Home (`#/`): `cold` on a fresh page, `reload` with the
//       stored copy, each until a shelf is drawn.
//   store  the stored library's cost as the longest timer gap in two windows: `write`, from the full
//       export's response until the `meta` record can be read (the page polls the `jean-library`
//       database every 50 ms, a read that queues behind the worker's writes), taken on B1's cold
//       load so it holds Jean's landing of that export too, and `read`, from the plain reload's
//       navigation start to the frame after the first row, the stored copy being drawn.
//   late  the first rows painted to the late part's response complete (`responseComplete`) and to the
//       frame after no row is marked `aria-busy` (`shown`), on B1's cold load. `shown` is 0 where no
//       row was busy at first paint; a negative figure is a part that arrived before the first rows.
//   export  the plain and gzipped bytes of the export for Jean's declared columns, each column's
//       bytes and share of the plain total, and `decodeMs`, `decodeJlib` in Node over those bytes.
//   scroll  the tallest element each browser honours and the last row of a 46 px list that gives,
//       found by bisection on a plain overflow element's `scrollHeight`, and the track list scrolled
//       to its end, with the last row it rendered against its `aria-rowcount`.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium, devices, firefox, webkit } from "@playwright/test";

import { type Args, type ProjectName, parseArgs } from "./args.ts";
import { orElse } from "./ceiling.ts";
import type { ExportCost, Pages } from "./exportCost.ts";
import { freePort, type RunningFake, startFake } from "./fakePlayer.ts";
import {
	CLOSE_MS,
	honouredHeightOf,
	measureRun,
	type ProjectDefinition,
	RELOAD_KINDS,
	type Reload,
	type RunResult,
	type Target,
	type Task,
	TIMELINE_MARKS,
	unmeasured,
} from "./measure.ts";
import {
	type Metric,
	metricOf,
	noResult,
	shortfall,
	summarise,
} from "./stats.ts";

const UI_ROOT = resolve(import.meta.dirname, "../..");
const OUT_DIR = resolve(UI_ROOT, "../_tmp/perf");
const DIST_DIR = join(OUT_DIR, "dist");
const DESKTOP_VIEWPORT = { width: 1280, height: 860 };
const PHONE_CPU_THROTTLE = 4;
const FALLBACK_ROW_HEIGHT = 46;

const PROJECTS: Record<ProjectName, ProjectDefinition> = {
	desktop: {
		engine: "chromium",
		options: { ...devices["Desktop Chrome"], viewport: DESKTOP_VIEWPORT },
		cpuThrottle: null,
	},
	mobile: {
		engine: "chromium",
		options: { ...devices["Pixel 7"] },
		cpuThrottle: PHONE_CPU_THROTTLE,
	},
	iphone: {
		engine: "webkit",
		options: { ...devices["iPhone 15"] },
		cpuThrottle: null,
	},
	firefox: {
		engine: "firefox",
		options: { ...devices["Desktop Firefox"], viewport: DESKTOP_VIEWPORT },
		cpuThrottle: null,
	},
};

const ENGINES = { chromium, firefox, webkit };

const log = (message: string) => process.stderr.write(`${message}\n`);

const failures = (runs: unknown[]) =>
	runs.find((run): run is Error => run instanceof Error);

function taskMetric(
	runs: (Task | Error)[],
	headline: (run: Task) => number,
	unit: string,
	window = "while the page works",
): Metric {
	const taken = runs.filter((run): run is Task => !(run instanceof Error));
	if (taken.length === 0) return noResult(failures(runs));
	const longTasks = taken.map((run) => run.longTaskMs);
	return {
		...summarise(taken.map(headline)),
		unit,
		...shortfall(runs),
		method: `longest gap between zero-delay timer turns ${window}`,
		longestLongTask: longTasks.some((entry) => entry === null)
			? { unavailable: "this engine has no longtask observer" }
			: summarise(longTasks as number[]),
	};
}

function reloadMetric(runs: (Reload | Error)[]) {
	const ms = (pick: (run: Reload) => number) =>
		runs.map((run) => (run instanceof Error ? run : pick(run)));
	return {
		...metricOf(ms((run) => run.ms)),
		unit: "ms",
		method:
			"the page's clock, navigation start to the frame after the first row painted",
		waited: {
			...metricOf(ms((run) => run.waitedMs)),
			unit: "ms",
			method:
				"the call that began the navigation to the same frame, on the clock outside the page",
		},
		landing: taskMetric(
			runs.map((run) => (run instanceof Error ? run : run.settled)),
			(task) => task.stallMs,
			"ms",
			"from navigation start until the late part is shown and the page has had a moment to itself",
		),
		leaving: metricOf(
			runs.map((run) =>
				run instanceof Error
					? run
					: (run.leavingMs ??
						new Error("this navigation did not follow a blank page")),
			),
		),
		exportRequested: runs.map((run) =>
			run instanceof Error ? null : run.exportRequested,
		),
		timeline: Object.fromEntries(
			TIMELINE_MARKS.map((mark) => [
				mark,
				metricOf(ms((run) => run.timeline[mark] as number)),
			]),
		),
	};
}

function projectReport(
	project: ProjectDefinition,
	runs: RunResult[],
	extras: object,
): object {
	const opened = (name: "album" | "artist" | "genre") =>
		metricOf(runs.map((run) => run.B4[name]));
	const allOpened = runs.map((run) => {
		const each = [run.B4.album, run.B4.artist, run.B4.genre];
		return failures(each) ?? Math.max(...(each as number[]));
	});

	const openedTasks = (name: "album" | "artist" | "genre") =>
		taskMetric(
			runs.map((run) => run.B4Tasks[name]),
			(task) => task.stallMs,
			"ms",
			"from the click on the page's link until its rows have painted and the page has had a moment to itself",
		);
	const slowestOpeningTasks = runs.map((run): Task | Error => {
		const each = [run.B4Tasks.album, run.B4Tasks.artist, run.B4Tasks.genre];
		const failed = failures(each);
		if (failed) return failed;
		const tasks = each as Task[];
		const longTasks = tasks.map((task) => task.longTaskMs);
		return {
			stallMs: Math.max(...tasks.map((task) => task.stallMs)),
			longTaskMs: longTasks.some((entry) => entry === null)
				? null
				: Math.max(...(longTasks as number[])),
		};
	});

	const keystrokes = runs.map((run) =>
		run.B3 instanceof Error ? run.B3 : run.B3.keystrokeMs,
	);
	const b3Tasks = runs.map((run) =>
		run.B3 instanceof Error
			? run.B3
			: { stallMs: run.B3.stallMs, longTaskMs: run.B3.longTaskMs },
	);

	return {
		engine: project.engine,
		cpuThrottle: project.cpuThrottle,
		B1: { ...metricOf(runs.map((run) => run.B1)), unit: "ms" },
		landing: taskMetric(
			runs.map((run) => run.landing),
			(task) => task.stallMs,
			"ms",
			"from navigation start until the late part is shown and the page has had a moment to itself",
		),
		B2: taskMetric(
			runs.map((run) => run.B2),
			(run) => run.stallMs,
			"ms",
		),
		B3: {
			...metricOf(keystrokes),
			unit: "ms",
			longestTask: taskMetric(b3Tasks, (run) => run.stallMs, "ms"),
		},
		home: {
			cold: taskMetric(
				runs.map((run) =>
					run.homeLanding instanceof Error
						? run.homeLanding
						: run.homeLanding.cold,
				),
				(task) => task.stallMs,
				"ms",
				"from navigation start of Home on a fresh page until a shelf is drawn, the late part is in and the page has had a moment to itself",
			),
			reload: taskMetric(
				runs.map((run) =>
					run.homeLanding instanceof Error
						? run.homeLanding
						: run.homeLanding.reload,
				),
				(task) => task.stallMs,
				"ms",
				"from navigation start of Home reloaded with a stored copy until a shelf is drawn and the page has had a moment to itself",
			),
		},
		B4: {
			...metricOf(allOpened),
			unit: "ms",
			of: "the slowest of the album, artist and genre page in each run",
			album: opened("album"),
			artist: opened("artist"),
			genre: opened("genre"),
			task: {
				...taskMetric(
					slowestOpeningTasks,
					(task) => task.stallMs,
					"ms",
					"from the click on the page's link until its rows have painted and the page has had a moment to itself",
				),
				of: "the longest main-thread task after the click, over the album, artist and genre page in each run",
				album: openedTasks("album"),
				artist: openedTasks("artist"),
				genre: openedTasks("genre"),
			},
		},
		B5: { ...metricOf(runs.map((run) => run.B5)), unit: "MB" },
		store: {
			write: {
				...metricOf(
					runs.map((run) =>
						run.storeWrite instanceof Error
							? run.storeWrite
							: run.storeWrite.stallMs,
					),
				),
				unit: "ms",
				method:
					"longest gap between zero-delay timer turns from the export's response arriving until the stored copy's meta record could be read",
				windowMs: metricOf(
					runs.map((run) =>
						run.storeWrite instanceof Error
							? run.storeWrite
							: run.storeWrite.windowMs,
					),
				),
			},
			read: {
				...metricOf(
					runs.map((run) =>
						run.B6.reload instanceof Error
							? run.B6.reload
							: run.B6.reload.stallToFirstRowsMs,
					),
				),
				unit: "ms",
				method:
					"longest gap between zero-delay timer turns from the reload's navigation start to the frame after the first row, the stored copy being drawn",
			},
		},
		late: {
			responseComplete: {
				...metricOf(
					runs.map((run) =>
						run.late instanceof Error ? run.late : run.late.responseMs,
					),
				),
				unit: "ms",
				from: "the first rows painted, to the late part's response complete",
			},
			shown: {
				...metricOf(
					runs.map((run) =>
						run.late instanceof Error ? run.late : run.late.shownMs,
					),
				),
				unit: "ms",
				from: "the first rows painted, to the frame after no row is marked busy",
			},
		},
		B6: {
			...reloadMetric(runs.map((run) => run.B6.reload)),
			...Object.fromEntries(
				RELOAD_KINDS.filter((kind) => kind !== "reload").map((kind) => [
					kind,
					reloadMetric(runs.map((run) => run.B6[kind])),
				]),
			),
		},
		B7: {
			...metricOf(
				runs.map((run) => (run.B7 instanceof Error ? run.B7 : run.B7.ms)),
			),
			unit: "ms",
			from: "the control request, which is before the player settles",
			sinceStateMoved: {
				...metricOf(
					runs.map((run) =>
						run.B7 instanceof Error ? run.B7 : run.B7.sinceStateMovedMs,
					),
				),
				unit: "ms",
				from: "the first GET /api/state answer whose structure moved, to the added rows painted",
			},
			changesRequested: {
				...metricOf(
					runs.map((run) =>
						run.B7 instanceof Error ? run.B7 : run.B7.changesRequestedMs,
					),
				),
				unit: "ms",
				from: "the state answer that moved structure, to the request for the changes starting",
			},
			changesComplete: {
				...metricOf(
					runs.map((run) =>
						run.B7 instanceof Error ? run.B7 : run.B7.changesCompleteMs,
					),
				),
				unit: "ms",
				from: "the state answer that moved structure, to the changes' response complete",
			},
			pollMs: metricOf(
				runs.map((run) => (run.B7 instanceof Error ? run.B7 : run.B7.pollMs)),
			),
			bytes: {
				...metricOf(
					runs.map((run) => (run.B7 instanceof Error ? run.B7 : run.B7.bytes)),
				),
				unit: "bytes",
				of: "every response finished in that window, headers included, the state poll too",
			},
		},
		...extras,
	};
}

// `src/` imports resolve through the unit suite's alias hook, which breaks the CommonJS packages
// Playwright loads, so the export is read in a process of its own.
function measureExportApart(origin: string, repeats: number) {
	const printed = execFileSync(
		process.execPath,
		[
			"--import",
			"./test/alias.ts",
			"test/perf/exportCostCli.ts",
			origin,
			String(repeats),
		],
		{ cwd: UI_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	);
	return JSON.parse(printed) as { cost: ExportCost; pages: Pages };
}

async function hasControls(origin: string) {
	const answer = await fetch(`${origin}/__control/state`);
	return answer.ok;
}

interface ProjectProgress {
	name: ProjectName;
	runs: RunResult[];
	browser: string | null;
	honouredPx: number | null;
}

interface SizeProgress {
	pages: Pages;
	export: ExportCost;
	fake: { startupMs: number } | null;
	projects: ProjectProgress[];
}

function scrollReport(progress: ProjectProgress) {
	const list = progress.runs[0]?.scrollEnd;
	const honouredPx = progress.honouredPx;
	const rowHeight =
		list !== undefined && !(list instanceof Error) && list.rowHeight > 0
			? list.rowHeight
			: FALLBACK_ROW_HEIGHT;
	return {
		honouredHeightPx: honouredPx ?? noResult(undefined),
		rowHeightPx: rowHeight,
		lastHonouredRow:
			honouredPx === null
				? noResult(undefined)
				: Math.floor(honouredPx / rowHeight),
		method:
			"bisection on the scrollHeight a plain overflow element reports, divided by the list's row height",
		list:
			list === undefined || list instanceof Error
				? noResult(list)
				: {
						...list,
						method:
							"the list scrolled to its end: the last row rendered against aria-rowcount",
					},
	};
}

async function profileProject(
	progress: ProjectProgress,
	target: Target,
	args: Args,
	stamp: string,
	tracks: number,
	saved: () => void,
) {
	const project = PROJECTS[progress.name];
	const launch = async () => {
		const browser = await ENGINES[project.engine].launch();
		progress.browser = `${project.engine} ${browser.version()}`;
		return browser;
	};
	let browser = await launch();
	try {
		for (let run = 0; run < args.runs; run += 1) {
			log(`  ${progress.name}: run ${run + 1} of ${args.runs}`);
			const into = unmeasured();
			progress.runs.push(into);
			const { pageStopped } = await measureRun(
				browser,
				project,
				target,
				{
					tracePath:
						args.trace && run === 0
							? join(OUT_DIR, `trace-${stamp}-${tracks}-${progress.name}.json`)
							: null,
					scrollEnd: run === 0,
				},
				into,
				saved,
			);
			if (pageStopped) {
				log("  the page stopped answering; a fresh browser follows");
				await orElse(CLOSE_MS, undefined, () => browser.close());
				browser = await launch();
			}
		}

		progress.honouredPx = await orElse(CLOSE_MS * 4, null, () =>
			honouredHeightOf(browser, project),
		);
		saved();
	} finally {
		await orElse(CLOSE_MS, undefined, () => browser.close());
	}
}

function projectsReport(progress: ProjectProgress[], aboveCeiling: boolean) {
	return Object.fromEntries(
		progress.map((entry) => [
			entry.name,
			{
				aboveCeiling,
				...projectReport(PROJECTS[entry.name], entry.runs, {
					browser: entry.browser,
					scroll: scrollReport(entry),
				}),
			},
		]),
	);
}

async function profileSize(
	origin: string,
	fake: RunningFake | null,
	args: Args,
	stamp: string,
	sizes: SizeProgress[],
	saved: () => void,
) {
	const { cost, pages } = measureExportApart(origin, args.runs);
	log(
		`${pages.trackCount} tracks: export ${cost.plainBytes} bytes, ${cost.gzippedBytes} gzipped${cost.aboveCeiling ? " (over the component's ceiling)" : ""}`,
	);

	const target: Target = {
		origin,
		pages,
		hasControls: await hasControls(origin),
	};

	const size: SizeProgress = {
		pages,
		export: cost,
		fake: fake === null ? null : { startupMs: fake.startupMs },
		projects: [],
	};
	sizes.push(size);
	saved();

	for (const name of args.projects) {
		log(`${pages.trackCount} tracks, ${name}`);
		const progress: ProjectProgress = {
			name,
			runs: [],
			browser: null,
			honouredPx: null,
		};
		size.projects.push(progress);
		await profileProject(
			progress,
			target,
			args,
			stamp,
			pages.trackCount,
			saved,
		);
	}
}

const sizeReport = (size: SizeProgress) => ({
	tracks: size.pages.trackCount,
	aboveCeiling: size.export.aboveCeiling,
	export: size.export,
	...(size.fake === null ? null : { fake: size.fake }),
	projects: projectsReport(size.projects, size.export.aboveCeiling),
});

async function main() {
	const args = parseArgs(process.argv.slice(2));
	mkdirSync(OUT_DIR, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const file = join(OUT_DIR, `report-${stamp}.json`);

	const dist = args.dist === null ? DIST_DIR : resolve(args.dist);
	if (args.url === null && args.dist === null) {
		execFileSync(
			"pnpm",
			["exec", "vite", "build", "--outDir", DIST_DIR, "--emptyOutDir"],
			{ cwd: UI_ROOT, stdio: "inherit" },
		);
	}

	const sizes: SizeProgress[] = [];
	const write = () =>
		writeFileSync(
			file,
			`${JSON.stringify(
				{
					generatedAt: new Date().toISOString(),
					target: args.url ?? "the fake player",
					runsPerCell: args.runs,
					node: process.version,
					sizes: sizes.map(sizeReport),
				},
				null,
				2,
			)}\n`,
		);

	for (const tracks of args.url === null ? args.tracks : [null]) {
		let fake: RunningFake | null = null;
		try {
			if (tracks !== null) {
				fake = await startFake({
					tracks,
					dist,
					port: args.port ?? (await freePort()),
				});
				log(
					`the fake took ${Math.round(fake.startupMs)} ms to build ${tracks} tracks`,
				);
			}
			await profileSize(
				fake?.origin ?? (args.url as string),
				fake,
				args,
				stamp,
				sizes,
				write,
			);
			write();
		} finally {
			await fake?.stop();
		}
	}

	process.stdout.write(`${file}\n`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
