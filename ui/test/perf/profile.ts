// `pnpm perf` measures costs of a large library, B1 to B5 and B7, and writes one JSON report,
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
// The page is built once into `dist` under `OUT_DIR` and served by the fake beside its API. Against a player, B2
// and B7 are unavailable: they need the fake's `/__control/` routes. The report is rewritten after
// every cell, so a killed run keeps what it measured. A cell not finished in its bound (two minutes
// for a load, one for the rest) is recorded as `{ over, reason }`; if the page then stops answering,
// the cells left in that run are recorded the same way and the next run starts in a fresh browser.
// Each project runs its cells `--runs` times (three by default) in a fresh context and reports
// `{ runs, median, spread }`, the spread being the largest run minus the smallest. `mobile` is Pixel 7
// emulation under Chromium's 4x CPU throttle; `edge` is `mobile` under Chromium's `Network.emulateNetworkConditions` at 150 ms, 2 Mbit/s down and 1 Mbit/s up;
// `iphone` is Playwright's WebKit with the iPhone 15
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
//   B7  one album added. `ms` runs from the control request and includes the player's own settle at
//       the next state poll; `sinceStateMoved` runs from the first state answer whose `structure`
//       moved to the added rows painted, which is what a person waits once the change is visible to
//       a client. `pollMs` is the median gap between state answers. Its bytes are every response
//       finished until the list shows the album, state polls included.
//   landing  the longest timer gap from the cold load's navigation start until the first rows are
//       shown and the page left to itself, so it holds every task of the load and is held to B2's
//       budget. `home` is the same window for Home (`#/`): `cold` on a fresh page, `reload` on a
//       reload, each until a shelf is drawn.
//   fling  after B5, on All Music and then on a playlist holding the whole library: a scripted
//       fling (`scrollTop` stepped each frame at a decaying speed), then jumps to 25%, 50%, 75% and
//       the end of the list, as a scrollbar drag makes. Each stop reports `ms`, from the list at rest
//       (no `scroll` event for two frames) to every row in the viewport painted (none `aria-busy`,
//       then the next frame), and `rowsRequests` and `tooManyRequests`, the `POST /api/library/rows`
//       and `GET /api/playlists/{id}/items` requests and the `429`s it caused. A tree without those
//       routes reads 0 for the first.
//   playlist  B1's clock on the hash of a playlist holding the whole library, loaded cold. The fake
//       makes it with `POST /api/playlists`, once per fake; it cannot fill an autoplaylist on
//       creation.
//   fake  beside every cell that asks the fake: `fake`, the `Server-Timing` of each `/api/` answer
//       given while the cell ran (for B3, B4, B6 and B7 while the cell's own clock ran), summed, and
//       `fakeMax`, the slowest one. The fake writes the header from the request's arrival to its
//       head being written. A cell's wait less its `fake` is what the page, the network and the
//       browser add. The sum counts answers that overlap and the state poll's, so it can exceed
//       the cell's clock.
//   scroll  the tallest element each browser honours and the last row of a 46 px list that gives,
//       found by bisection on a plain overflow element's `scrollHeight`, and the track list scrolled
//       to its end, with the last row it rendered against its `aria-rowcount`.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium, devices, firefox, webkit } from "@playwright/test";
import type { FakeTime } from "./answers.ts";
import { type Args, type ProjectName, parseArgs } from "./args.ts";
import { orElse } from "./ceiling.ts";
import {
	freePort,
	makeWholeLibraryPlaylist,
	type RunningFake,
	startFake,
} from "./fakePlayer.ts";
import { FLING_STOPS, type FlingStop, type Stopped } from "./fling.ts";
import {
	CLOSE_MS,
	honouredHeightOf,
	measureRun,
	type ProjectDefinition,
	type RunResult,
	type Step,
	type Target,
	type Task,
	unmeasured,
} from "./measure.ts";
import type { Pages } from "./pages.ts";
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
const EDGE_NETWORK = {
	latencyMs: 150,
	downBytesPerSecond: (2 * 1_000_000) / 8,
	upBytesPerSecond: (1 * 1_000_000) / 8,
};
const FALLBACK_ROW_HEIGHT = 46;

const PROJECTS: Record<ProjectName, ProjectDefinition> = {
	desktop: {
		engine: "chromium",
		options: { ...devices["Desktop Chrome"], viewport: DESKTOP_VIEWPORT },
		cpuThrottle: null,
		network: null,
	},
	mobile: {
		engine: "chromium",
		options: { ...devices["Pixel 7"] },
		cpuThrottle: PHONE_CPU_THROTTLE,
		network: null,
	},
	edge: {
		engine: "chromium",
		options: { ...devices["Pixel 7"] },
		cpuThrottle: PHONE_CPU_THROTTLE,
		network: EDGE_NETWORK,
	},
	iphone: {
		engine: "webkit",
		options: { ...devices["iPhone 15"] },
		cpuThrottle: null,
		network: null,
	},
	firefox: {
		engine: "firefox",
		options: { ...devices["Desktop Firefox"], viewport: DESKTOP_VIEWPORT },
		cpuThrottle: null,
		network: null,
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

function fakeBeside(runs: RunResult[], steps: Step[]) {
	const taken = runs.map((run): FakeTime[] | Error => {
		const times = steps.flatMap((step) => run.fake[step] ?? []);
		return times.length < steps.length
			? new Error("the cell did not run")
			: times;
	});
	const of = (pick: (times: FakeTime[]) => number) =>
		metricOf(
			taken.map((times) => (times instanceof Error ? times : pick(times))),
		);
	return {
		fake: {
			...of((times) => times.reduce((sum, time) => sum + time.ms, 0)),
			unit: "ms",
			of: "the Server-Timing of every /api/ answer the fake gave while the cell ran, summed",
		},
		fakeMax: {
			...of((times) => Math.max(...times.map((time) => time.maxMs))),
			unit: "ms",
			of: "the slowest single answer",
		},
		fakeAnswers: of((times) =>
			times.reduce((sum, time) => sum + time.answers, 0),
		),
	};
}

const FLING_STEP = {
	allMusic: "fling all",
	playlist: "fling playlist",
} as const;

function flingMetric(runs: RunResult[], list: keyof RunResult["fling"]) {
	const stop = (name: FlingStop) => {
		const each = (pick: (stopped: Stopped) => number) =>
			metricOf(
				runs.map((run) => {
					const fling = run.fling[list];
					return fling instanceof Error ? fling : pick(fling[name]);
				}),
			);
		return {
			ms: { ...each((stopped) => stopped.ms), unit: "ms" },
			rowsRequests: each((stopped) => stopped.rowsRequests),
			tooManyRequests: each((stopped) => stopped.tooManyRequests),
		};
	};
	return {
		method:
			"per stop, the time from the list at rest (no scroll event for two frames) to every row in the viewport painted, with the rows requests and 429s the stop caused",
		...Object.fromEntries(FLING_STOPS.map((name) => [name, stop(name)])),
		...fakeBeside(runs, [FLING_STEP[list]]),
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
		B1: {
			...metricOf(runs.map((run) => run.B1)),
			unit: "ms",
			...fakeBeside(runs, ["B1"]),
		},
		landing: {
			...taskMetric(
				runs.map((run) => run.landing),
				(task) => task.stallMs,
				"ms",
				"from navigation start until the first rows are shown and the page has had a moment to itself",
			),
			...fakeBeside(runs, ["landing"]),
		},
		B2: {
			...taskMetric(
				runs.map((run) => run.B2),
				(run) => run.stallMs,
				"ms",
			),
			...fakeBeside(runs, ["B2"]),
		},
		playlist: {
			...metricOf(runs.map((run) => run.playlist)),
			unit: "ms",
			method:
				"B1's clock on the hash of a playlist holding the whole library: navigation start to the frame after the first row",
			...fakeBeside(runs, ["playlist"]),
		},
		fling: {
			allMusic: flingMetric(runs, "allMusic"),
			playlist: flingMetric(runs, "playlist"),
		},
		B3: {
			...metricOf(keystrokes),
			unit: "ms",
			...fakeBeside(runs, ["B3"]),
			longestTask: taskMetric(b3Tasks, (run) => run.stallMs, "ms"),
		},
		home: {
			...fakeBeside(runs, ["home landing"]),
			cold: taskMetric(
				runs.map((run) =>
					run.homeLanding instanceof Error
						? run.homeLanding
						: run.homeLanding.cold,
				),
				(task) => task.stallMs,
				"ms",
				"from navigation start of Home on a fresh page until a shelf is drawn and the page has had a moment to itself",
			),
			reload: taskMetric(
				runs.map((run) =>
					run.homeLanding instanceof Error
						? run.homeLanding
						: run.homeLanding.reload,
				),
				(task) => task.stallMs,
				"ms",
				"from navigation start of Home on a reload until a shelf is drawn and the page has had a moment to itself",
			),
		},
		B4: {
			...metricOf(allOpened),
			unit: "ms",
			of: "the slowest of the album, artist and genre page in each run",
			...fakeBeside(runs, ["B4 album", "B4 artist", "B4 genre"]),
			album: { ...opened("album"), ...fakeBeside(runs, ["B4 album"]) },
			artist: { ...opened("artist"), ...fakeBeside(runs, ["B4 artist"]) },
			genre: { ...opened("genre"), ...fakeBeside(runs, ["B4 genre"]) },
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
		B7: {
			...metricOf(
				runs.map((run) => (run.B7 instanceof Error ? run.B7 : run.B7.ms)),
			),
			unit: "ms",
			...fakeBeside(runs, ["B7"]),
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
// Playwright loads, so the pages are named in a process of their own.
function readPagesApart(origin: string) {
	const printed = execFileSync(
		process.execPath,
		["--import", "./test/alias.ts", "test/perf/pagesCli.ts", origin],
		{ cwd: UI_ROOT, encoding: "utf8" },
	);
	return JSON.parse(printed) as Pages;
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

function projectsReport(progress: ProjectProgress[]) {
	return Object.fromEntries(
		progress.map((entry) => [
			entry.name,
			projectReport(PROJECTS[entry.name], entry.runs, {
				browser: entry.browser,
				scroll: scrollReport(entry),
			}),
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
	const pages = readPagesApart(origin);

	const controls = await hasControls(origin);
	const playlistId = controls
		? await makeWholeLibraryPlaylist(origin, pages.trackCount).catch(
				(error: Error) => {
					log(`no playlist of the whole library: ${error.message}`);
					return null;
				},
			)
		: null;
	const target: Target = {
		origin,
		pages,
		hasControls: controls,
		playlistHash: playlistId === null ? null : `#/${playlistId}`,
	};

	const size: SizeProgress = {
		pages,
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
	...(size.fake === null ? null : { fake: size.fake }),
	projects: projectsReport(size.projects),
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
