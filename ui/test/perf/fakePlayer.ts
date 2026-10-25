import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";

import { WHOLE_LIBRARY } from "../fake-api/fooJean/wholeLibrary.ts";

export interface RunningFake {
	origin: string;
	startupMs: number;
	stop: () => Promise<void>;
}

const UI_ROOT = join(import.meta.dirname, "../..");

export const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address() as { port: number };
			probe.close(() => resolve(port));
		});
	});

export const postControl = (origin: string, action: string, body: object) =>
	fetch(new URL(`/__control/${action}`, origin), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

export async function startFake({
	tracks,
	dist,
	port,
}: {
	tracks: number;
	dist: string;
	port: number;
}): Promise<RunningFake> {
	const began = performance.now();
	const child: ChildProcess = spawn(
		process.execPath,
		[
			"--max-old-space-size=8192",
			"test/fake-api/main.ts",
			"--tracks",
			String(tracks),
			"--rate-limits",
			"--port",
			String(port),
			"--serve",
			dist,
		],
		{ cwd: UI_ROOT, stdio: ["ignore", "pipe", "inherit"] },
	);

	await new Promise<void>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code) =>
			reject(new Error(`the fake exited with ${code} before it listened`)),
		);
		child.stdout?.on("data", (chunk: Buffer) => {
			if (chunk.toString().includes("fake foo_jean on")) resolve();
		});
	});

	child.removeAllListeners("exit");
	const stopped = new Promise<void>((resolve) =>
		child.once("exit", () => resolve()),
	);
	return {
		origin: `http://127.0.0.1:${port}`,
		startupMs: performance.now() - began,
		stop: () => {
			child.kill("SIGTERM");
			return stopped;
		},
	};
}

// The playlist holding the whole library: the one a fake started with `--tracks` already holds,
// or else an ordinary playlist made here, since a real player has none and an autoplaylist cannot
// be filled on creation.
export async function makeWholeLibraryPlaylist(
	origin: string,
	trackCount: number,
): Promise<string> {
	const listed = (await (
		await fetch(new URL("/api/playlists", origin))
	).json()) as { playlists: { id: string; title: string }[] };
	const held = listed.playlists.find((entry) => entry.title === WHOLE_LIBRARY);
	if (held) return held.id;

	const state = (await (await fetch(new URL("/api/state", origin))).json()) as {
		library: { structure: number };
	};
	const made = await fetch(new URL("/api/playlists", origin), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: WHOLE_LIBRARY,
			structure: state.library.structure,
			runs: [[0, trackCount]],
		}),
	});
	if (!made.ok) throw new Error(`POST /api/playlists answered ${made.status}`);
	return ((await made.json()) as { id: string }).id;
}
