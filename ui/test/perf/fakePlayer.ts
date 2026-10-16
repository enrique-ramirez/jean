import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";

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
			"--no-ceiling",
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
