import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import {
	nextTrack,
	pause,
	playPause,
	previousTrack,
	resume,
	stop,
} from "../../src/shared/api/playback.ts";
import { playPlaylistItem } from "../../src/shared/api/playlists.ts";

let received: { path: string; contentType: string | null }[] = [];
let origin = "";

const server = createServer((request, response) => {
	received.push({
		path: request.url ?? "",
		contentType: request.headers["content-type"] ?? null,
	});
	request.resume();
	request.on("end", () => {
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end("{}");
	});
});

before(async () => {
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
	server.close();
});

beforeEach(() => {
	received = [];
});

const isJson = (contentType: string | null) =>
	contentType?.toLowerCase().startsWith("application/json") ?? false;

test("every command Jean posts with no body still says it is JSON", async () => {
	await playPause(origin);
	await pause(origin);
	await resume(origin);
	await nextTrack(origin);
	await previousTrack(origin);
	await stop(origin);
	await playPlaylistItem(origin, "00000000-0000-4000-8000-000000000007", 2);

	assert.deepEqual(
		received.map(({ path, contentType }) => ({
			path,
			json: isJson(contentType),
		})),
		[
			{ path: "/api/playback/play-pause", json: true },
			{ path: "/api/playback/pause", json: true },
			{ path: "/api/playback/resume", json: true },
			{ path: "/api/playback/next", json: true },
			{ path: "/api/playback/previous", json: true },
			{ path: "/api/playback/stop", json: true },
			{
				path: "/api/playlists/00000000-0000-4000-8000-000000000007/items/2/play",
				json: true,
			},
		],
	);
});
