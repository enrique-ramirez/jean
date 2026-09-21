import {
	openSidebar,
	searchFor,
	sidebar,
	trackRow,
	viewHeader,
} from "../e2e/fixtures.ts";
import { capabilities, playlists, TOKEN } from "./component.ts";
import { expect, type Page, test } from "./fixtures.ts";

// The control for c32.spec.ts, run with `writePlaylists` back on: every selector that answered zero
// there has to answer something here, or the zeros said nothing about the setting.

const QUERY = process.env.LIVE_QUERY ?? "80Kidz";

const seedToken = (page: Page) =>
	page.addInitScript((token: string) => {
		window.localStorage.setItem("jean.fooJeanToken", JSON.stringify(token));
	}, TOKEN());

const openAllMusic = async (page: Page) => {
	await page.goto("#/all");
	await expect(
		page.getByRole("heading", { level: 1, name: "All music" }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
};

test.describe.configure({ mode: "serial" });

test("the same controls are all drawn once the setting is back on", async ({
	page,
}) => {
	const answer = await capabilities();
	console.log(`[control] canWritePlaylists: ${answer.canWritePlaylists}`);
	expect(answer.canWritePlaylists).toBe(true);

	const shown = (await playlists()).filter((entry) => entry.role === null);

	await seedToken(page);
	await openAllMusic(page);
	await openSidebar(page);

	const newPlaylist = page.getByRole("button", { name: "New playlist" });
	console.log(`[control] New playlist buttons: ${await newPlaylist.count()}`);
	await expect(newPlaylist).toHaveCount(1);

	const grips = sidebar(page).locator('[class*="grip"]');
	console.log(`[control] reorder grips in the sidebar: ${await grips.count()}`);
	expect(await grips.count()).toBeGreaterThan(0);

	const row = sidebar(page)
		.locator("> div")
		.filter({ has: page.getByText(shown[0].title, { exact: true }) });
	await row.click({ button: "right" });
	await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
	await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
	console.log(`[control] Rename and Delete in a playlist's menu: both drawn`);
	await page.keyboard.press("Escape");

	await trackRow(page, 2).click({ button: "right" });
	const addTo = page.getByRole("menuitem", { name: /Add to playlist/ });
	await expect(addTo).toBeVisible();
	console.log(`[control] Add to playlist in a track's menu: drawn`);
	await page.keyboard.press("Escape");

	await searchFor(page, QUERY);
	const saveAs = viewHeader(page).getByRole("button", {
		name: /Save as playlist/,
	});
	await expect(saveAs).toBeVisible();
	console.log(`[control] Save as playlist: drawn`);
});
