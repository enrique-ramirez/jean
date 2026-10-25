import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const UI = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Neither the captured library's 54 tracks nor `Recently Added`'s 5, so only a playlist of the
// generated library can hold this many.
const TRACKS = 37;

const freePort = async () => {
	const probe = createServer().listen(0, "127.0.0.1");
	await once(probe, "listening");
	const address = probe.address();
	assert.ok(address && typeof address === "object");
	probe.close();
	await once(probe, "close");
	return address.port;
};

const started = async (child: ChildProcess) => {
	let said = "";
	child.stderr?.on("data", (chunk) => {
		said += chunk;
	});
	await new Promise<void>((ready, failed) => {
		child.stdout?.on("data", (chunk) => {
			if (String(chunk).includes("fake foo_jean on")) ready();
		});
		child.once("exit", (code) =>
			failed(new Error(`the fake exited ${code} before listening: ${said}`)),
		);
	});
};

interface Annotation {
	id: string;
	title: string;
	itemCount: number;
	isAutoPlaylist: boolean;
}

test("the fake started with --tracks N holds one autoplaylist, named plainly, whose rows are every track of the library", async (t) => {
	const port = await freePort();
	const child = spawn(
		process.execPath,
		[
			join(UI, "test/fake-api/main.ts"),
			"--tracks",
			String(TRACKS),
			"--port",
			String(port),
		],
		{ cwd: UI, stdio: ["ignore", "pipe", "pipe"] },
	);
	t.after(() => child.kill());
	await started(child);
	const origin = `http://localhost:${port}`;

	const { playlists } = (await (
		await fetch(`${origin}/api/playlists`)
	).json()) as { playlists: Annotation[] };
	const whole = playlists.filter(
		(playlist) => playlist.isAutoPlaylist && playlist.itemCount === TRACKS,
	);
	assert.equal(whole.length, 1, JSON.stringify(playlists));
	assert.ok(!whole[0].title.startsWith("#Jean"), whole[0].title);

	const page = await fetch(
		`${origin}/api/playlists/${whole[0].id}/items?offset=0&count=${TRACKS}&columns=%25title%25`,
	);
	assert.equal(page.status, 200);
	const { totalCount, items } = (await page.json()) as {
		totalCount: number;
		items: { libraryPath: string | null }[];
	};
	assert.equal(totalCount, TRACKS);
	const paths = new Set(items.map((row) => row.libraryPath));
	assert.ok(!paths.has(null), "a row the library does not hold");
	assert.equal(paths.size, TRACKS, "a track held twice, or one left out");
});
