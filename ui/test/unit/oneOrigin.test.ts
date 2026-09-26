import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as live from "../live/component.ts";

const UI = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(UI, "src");
const LIVE = join(UI, "test/live");

const filesUnder = (folder: string, keep: RegExp): string[] =>
	readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
		if (entry.name === "node_modules" || entry.name === "dist") return [];
		const path = join(folder, entry.name);
		if (entry.isDirectory()) return filesUnder(path, keep);
		return keep.test(entry.name) ? [path] : [];
	});

const linesNaming = (files: string[], names: RegExp) =>
	files.flatMap((file) =>
		readFileSync(file, "utf8")
			.split("\n")
			.flatMap((line, index) =>
				names.test(line) ? [`${relative(UI, file)}:${index + 1}`] : [],
			),
	);

test("nothing under src/ names the second origin, the discovery record or clientconfig", () => {
	const names =
		/originOfPort|__PLAYER_HOST__|fetchDiscoveryRecord|FOO_JEAN_ID|clientconfig/;

	assert.deepEqual(linesNaming(filesUnder(SRC, /\.tsx?$/), names), []);
});

test("nothing under test/live/ names the old origin, a token, or a default from one particular library", () => {
	const names =
		/8880|clientconfig|\/jean\/|LIVE_COMPONENT|LIVE_FOO_JEAN_TOKEN|seedToken|Bearer|LIVE_PLAYLIST|LIVE_QUERY|#T10|80Kidz/;

	assert.deepEqual(linesNaming(filesUnder(LIVE, /\.ts$/), names), []);
});

// details-read.spec.ts names the route only to watch the page's own requests for one.
test("only component.ts and details-read.spec.ts name /api/tags under test/live/", () => {
	const files = new Set(
		linesNaming(filesUnder(LIVE, /\.ts$/), /\/api\/tags/).map(
			(hit) => hit.split(":")[0],
		),
	);

	assert.deepEqual([...files].sort(), [
		"test/live/component.ts",
		"test/live/details-read.spec.ts",
	]);
});

const ROOT = "D:\\throwaway\\music\\";
const INSIDE = `${ROOT}Artist\\Album\\01.flac`;
const OUTSIDE = "E:\\music\\Artist\\Album\\01.flac";
const COPY_OF_ROOT = `E:\\backup\\${INSIDE}`;

const recordingFetch = (t: { after: (fn: () => void) => void }) => {
	const realFetch = globalThis.fetch;
	const realLive = process.env.LIVE;
	const realRoot = process.env.LIVE_LIBRARY_ROOT;
	const sent: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		sent.push(String(input));
		return new Response("", { status: 200 });
	}) as typeof fetch;
	process.env.LIVE = "http://127.0.0.1:9";
	t.after(() => {
		globalThis.fetch = realFetch;
		if (realLive === undefined) delete process.env.LIVE;
		else process.env.LIVE = realLive;
		if (realRoot === undefined) delete process.env.LIVE_LIBRARY_ROOT;
		else process.env.LIVE_LIBRARY_ROOT = realRoot;
	});
	return sent;
};

test("underRoot holds for a path inside the library root and not for one outside it", () => {
	assert.equal(live.underRoot(INSIDE, ROOT), true);
	assert.equal(live.underRoot(OUTSIDE, ROOT), false);
	assert.equal(live.underRoot(COPY_OF_ROOT, ROOT), false);
});

test("writeRating refuses a track outside LIVE_LIBRARY_ROOT, naming both, before it sends anything", async (t) => {
	const sent = recordingFetch(t);
	process.env.LIVE_LIBRARY_ROOT = ROOT;

	await assert.rejects(
		async () => live.writeRating({ track: "t1", path: OUTSIDE }, "3"),
		(error: Error) =>
			error.message.includes(OUTSIDE) && error.message.includes(ROOT),
	);
	assert.deepEqual(sent, []);
});

// With no root there is nothing to prove the write lands on a throwaway install, so it must not go.
test("writeRating refuses every write when LIVE_LIBRARY_ROOT is unset", async (t) => {
	const sent = recordingFetch(t);
	delete process.env.LIVE_LIBRARY_ROOT;

	await assert.rejects(async () =>
		live.writeRating({ track: "t1", path: INSIDE }, "3"),
	);
	assert.deepEqual(sent, []);
});

test("writeRating sends a track inside LIVE_LIBRARY_ROOT to /api/tags", async (t) => {
	const sent = recordingFetch(t);
	process.env.LIVE_LIBRARY_ROOT = ROOT;

	await live.writeRating({ track: "t1", path: INSIDE }, "3");
	assert.deepEqual(sent, ["http://127.0.0.1:9/api/tags"]);
});

const DEFAULT_TARGET = "http://localhost:8881";
const PLAYER_VARIABLES = new Set(["FOO_JEAN_URL"]);

// `test/alias.ts` cannot resolve Vite's own CommonJS dependencies, so the config is loaded in a
// plain node beside the suite. Vite's `loadEnv` reads `.env` files from the working directory,
// which is why that node runs in an empty one: the owner's `.env.local` must not decide what
// "no environment" means.
const READ_API_TARGET = `
const { default: config } = await import(process.argv[1]);
const resolved = typeof config === "function"
	? await config({ command: "serve", mode: "development" })
	: await config;
const route = resolved.server?.proxy?.["/api"];
process.stdout.write(JSON.stringify(typeof route === "string" ? route : route?.target ?? null));
`;

let empty = "";

before(() => {
	empty = mkdtempSync(join(tmpdir(), "jean-one-origin-"));
});

after(() => rmSync(empty, { recursive: true, force: true }));

const devServerApiTarget = (variables: Record<string, string> = {}) => {
	const inherited = Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !PLAYER_VARIABLES.has(name)),
	);
	const output = execFileSync(
		process.execPath,
		["--input-type=module", "-e", READ_API_TARGET, join(UI, "vite.config.ts")],
		{ cwd: empty, env: { ...inherited, ...variables }, encoding: "utf8" },
	);
	return JSON.parse(output);
};

test("the dev server proxies /api to foo_jean on localhost:8881 when nothing names a player", () => {
	assert.equal(devServerApiTarget(), DEFAULT_TARGET);
});

test("FOO_JEAN_URL points the dev server's /api proxy at another player", () => {
	assert.equal(
		devServerApiTarget({ FOO_JEAN_URL: "http://player.lan:8881" }),
		"http://player.lan:8881",
	);
});
