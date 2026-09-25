import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const UI = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(UI, "src");

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
