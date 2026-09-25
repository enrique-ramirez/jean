import { fold } from "../../src/shared/lib/text.ts";
import {
	openSettings,
	scrollUntilMounted,
	statusBar,
	trackRow,
} from "../e2e/fixtures.ts";
import { api, expect, type Install, reset, test } from "./fixtures.ts";

// One player, which cannot be reset between tests the way the fake is, so these run in order and
// each one puts back whatever it started.
test.describe.configure({ mode: "serial" });

// A library may hold files with no tags at all, and a row reading `?` proves nothing about the
// join between what the player resolved and what Jean drew. So assertions about metadata pick
// the first track the player answered for.
const tagged = (install: Install) => {
	const index = install.tracks.findIndex(
		(track) => track.title !== "?" && track.artist !== "?",
	);
	if (index < 0)
		throw new Error(
			"every track in this library is untagged, so nothing here can be checked against its metadata",
		);
	return { index, track: install.tracks[index] };
};

test("all music holds exactly as many rows as the player reports", async ({
	page,
	install,
}) => {
	await page.goto("#/all");
	await expect(
		page.getByRole("heading", { level: 1, name: "All music" }),
	).toBeVisible();
	// aria-rowcount is the whole set rather than what is mounted, so this is the count the
	// virtualiser believes in and not the handful of rows on screen.
	await expect(page.getByRole("grid")).toHaveAttribute(
		"aria-rowcount",
		String(install.itemCount),
	);
});

test("a row carries the metadata the player resolved for that path", async ({
	page,
	install,
}) => {
	const { index, track } = tagged(install);
	await page.goto("#/all");
	const row = trackRow(page, index);
	await expect(row).toContainText(track.title);
	await expect(row).toContainText(track.artist);
});

test("a cover decodes as image bytes rather than rendering a placeholder", async ({
	page,
}) => {
	// Album layout is where a cover is drawn per group; compact shows rows.
	await page.addInitScript(() =>
		window.localStorage.setItem("jean.layout", JSON.stringify("album")),
	);
	await page.goto("#/all");
	const cover = page.locator("main img").first();
	await expect(cover).toBeVisible();
	// naturalWidth is zero for a broken or still-loading image, so this is the only assertion that
	// distinguishes artwork the player actually returned from an element with a src.
	await expect
		.poll(() => cover.evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBeGreaterThan(0);
});

test("an unaccented query finds an accented artist", async ({
	page,
	install,
}) => {
	// An artist that folding actually changes, which is the only kind this can say anything about.
	const accented = install.tracks.find(
		(track) => fold(track.artist) !== track.artist.toLowerCase(),
	);
	test.skip(
		!accented,
		"this library has no accented artist, so there is nothing for fold() to strip",
	);
	await page.goto("#/all");
	// The control names the list it searches -- "Find in all music" here, "Find in this shelf"
	// elsewhere -- so it is matched by its prefix rather than by one view's wording.
	await page.getByRole("button", { name: /^Find in / }).click();
	await page
		.getByRole("textbox", { name: /^Find in / })
		.fill(fold((accented as Install["tracks"][number]).artist));
	await expect(
		page.locator('[role="row"][data-match="true"]').first(),
	).toBeVisible();
});

test("double-clicking a row plays that track on the player", async ({
	page,
	install,
}) => {
	const { index, track } = tagged(install);
	await page.goto("#/all");
	await trackRow(page, index).dblclick();

	// The path, not the index: playing a set writes it to the scratch playlist first, so the
	// player's own index addresses a different list from the one on screen. This is the join the
	// fake cannot check, because there it supplies both sides.
	await expect
		.poll(async () => {
			const { player } = await api<{
				player: { activeItem: { columns: string[] } };
			}>(install.origin, "/player?columns=%25path%25");
			return player.activeItem.columns[0];
		})
		.toBe(track.path);

	// Nothing above put this on screen: it arrives on the update stream from a real player.
	await expect(statusBar(page)).toContainText(track.title);

	await reset(install.origin);
});

test("add to queue reaches the player's own play queue", async ({
	page,
	install,
}) => {
	const { index, track } = tagged(install);
	await page.goto("#/all");
	await trackRow(page, index).click({ button: "right" });
	await page.getByRole("menuitem", { name: "Add to queue" }).click();

	await expect
		.poll(async () => {
			const { playQueue } = await api<{
				playQueue: { columns: string[] }[];
			}>(install.origin, "/query?playQueue=true&qcolumns=%25path%25");
			return playQueue.map((entry) => entry.columns[0]);
		})
		.toContain(track.path);

	await reset(install.origin);
});

test("stars are read-only where nothing can write a tag", async ({
	page,
	install,
}) => {
	test.skip(
		install.hasFooJean,
		"the component is installed, so the stars are controls rather than a readout",
	);
	const rated = install.tracks.findIndex((track) => track.rating !== "?");
	test.skip(rated < 0, "no track in this library carries a rating tag");

	await page.goto("#/all");
	// Which row carries a rating is the library's business, and the list is virtualised, so the
	// first rated track is as likely to be off screen as on it.
	await scrollUntilMounted(page, trackRow(page, rated));

	// An image when read-only, a group of buttons when writable. Naming both is how this fails
	// loudly if the seam ever offers controls with no writer behind them.
	await expect(
		trackRow(page, rated).getByRole("img", { name: /stars|Unrated/ }),
	).toBeVisible();
	await expect(
		trackRow(page, rated).getByRole("group", { name: /stars|Unrated/ }),
	).toHaveCount(0);
});

test("settings reports what the discovery actually found on this player", async ({
	page,
	install,
}) => {
	await page.goto("#/all");
	await openSettings(page);
	const panel = page.getByRole("region", { name: "foo_jean" });
	await expect(panel).toBeVisible();

	if (install.hasFooJean) {
		await expect(panel).toContainText("Connected");
	} else {
		await expect(panel).toContainText("Not connected");
	}
});

test("toggling shuffle reaches the player, whichever option set it exposes", async ({
	page,
	install,
}) => {
	// foobar2000 carries the order as a `playbackOrder` option and DeaDBeeF as `shuffle` plus
	// `repeat`, answering 400 for that id. Reading falls back to the deprecated `playbackMode`
	// on its own, so a write aimed at the wrong one leaves the button looking right and does
	// nothing -- which is invisible against a fake modelled on either player alone.
	const mode = async () => {
		const { player } = await api<{ player: { playbackMode: number } }>(
			install.origin,
			"/player",
		);
		return player.playbackMode;
	};
	const before = await mode();

	await page.goto("#/all");
	const shuffle = statusBar(page).getByRole("button", { name: "Shuffle" });
	await expect(shuffle).toBeEnabled();
	await shuffle.click();

	await expect.poll(mode).not.toBe(before);
	await expect(shuffle).toHaveAttribute("aria-pressed", "true");

	await shuffle.click();
	await expect.poll(mode).toBe(before);
});
