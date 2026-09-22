import { trackRow } from "../e2e/fixtures.ts";
import {
	capabilities,
	copyToNewPlaylist,
	playlists,
	playRow,
	removePlaylist,
	rowsOf,
	state,
} from "./component.ts";
import { expect, seedToken, test } from "./fixtures.ts";

// Starting a row is not the same as deciding where the track after it comes from, and only a real
// player can tell the two apart: `POST /playlists/{id}/items/{index}/play` reaches
// `playlist_execute_default_action`, which the route tests stub and no fake models.
// plugins/fb2k/ARCHITECTURE.md, *Facts about the player*, has why that matters.

test.describe.configure({ mode: "serial" });

const FOCUS_AWAY = "#live playing-a-set";

const focused = async () => (await state()).player.currentPlaylistId;

// The `install` fixture would ask for this declaration, but it reads a beefweb library route
// that released beefweb 0.10 answers `404`, and nothing else here needs beefweb at all.
const disposableRoot = () => {
	const root = process.env.LIVE_LIBRARY_ROOT;
	if (!root)
		throw new Error("LIVE_LIBRARY_ROOT must name the disposable library root");
	return root;
};

const firstPathOf = async (id: string) =>
	(await rowsOf(id, 0, 1)).items[0].columns[0];

test("playing a row leaves the player focused on that playlist", async () => {
	const root = disposableRoot();

	const holding = (await playlists()).find(
		(entry) => entry.role === null && entry.itemCount >= 1,
	);
	const writable = (await capabilities()).canWritePlaylists;
	test.skip(
		!holding || !writable,
		"this player holds no playlist with a row in it, or will not take a second one to move the focus off",
	);
	if (!holding || !writable) return;

	expect(
		await firstPathOf(holding.id),
		`${holding.title} sits outside ${root}, refusing to play it`,
	).toContain(root);

	const second = await copyToNewPlaylist(FOCUS_AWAY, holding.id, 1);
	try {
		await playRow(second.id, 0);
		await expect.poll(focused).toBe(second.id);

		await playRow(holding.id, 0);
		await expect.poll(focused).toBe(holding.id);

		expect((await state()).player.playingLocation?.playlistId).toBe(holding.id);
	} finally {
		await removePlaylist(second.id);
	}
});

test("a set played from a library view leaves the player focused on that set", async ({
	page,
}) => {
	const root = disposableRoot();
	const elsewhere = (await playlists()).find(
		(entry) => entry.role === null && entry.itemCount >= 1,
	);
	test.skip(
		!elsewhere,
		"this player holds no playlist of its own to play first, so nothing here could fail",
	);
	if (!elsewhere) return;

	await playRow(elsewhere.id, 0);
	await expect.poll(focused).toBe(elsewhere.id);

	await seedToken(page);
	// Playback is running by now, and All music holds the track it is running, so Jean would scroll
	// the list to it and recycle the row being reached for out from under the click.
	await page.addInitScript(() =>
		window.localStorage.setItem("jean.followPlayback", JSON.stringify(false)),
	);
	await page.goto("#/all");
	await expect(
		page.getByRole("heading", { level: 1, name: "All music" }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
	await trackRow(page, 1).dblclick();

	await expect
		.poll(async () => (await state()).player.playback)
		.toBe("playing");
	const scratch = (await playlists()).find((entry) => entry.role === "scratch");
	expect(scratch).toBeDefined();
	if (!scratch) return;

	expect(
		await firstPathOf(scratch.id),
		`this player's library sits outside ${root}`,
	).toContain(root);

	expect(await focused()).toBe(scratch.id);
	expect((await state()).player.playingLocation?.playlistId).toBe(scratch.id);
});
