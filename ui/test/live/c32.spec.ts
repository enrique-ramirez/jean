import {
	dragFrom,
	openSidebar,
	searchFor,
	sidebar,
	trackRow,
	viewHeader,
} from "../e2e/fixtures.ts";
import { capabilities, playlists, TOKEN } from "./component.ts";
import { expect, type Page, test } from "./fixtures.ts";

// Criterion 32 on a real player, with `writePlaylists` off in the component's own config.json and
// the player restarted, so the capabilities Jean reads at discovery already say no.

const QUERY = process.env.LIVE_QUERY ?? "80Kidz";

const seedToken = (page: Page) =>
	page.addInitScript((token: string) => {
		window.localStorage.setItem("jean.fooJeanToken", JSON.stringify(token));
	}, TOKEN());

const sidebarRow = (page: Page, title: string) =>
	sidebar(page)
		.locator("> div")
		.filter({ has: page.getByText(title, { exact: true }) });

const menuItem = (page: Page, name: string | RegExp) =>
	page.getByRole("menuitem", { name });

// Jean is served under a path here, so the route hash is relative: `/#/all` would reach beefweb's
// own web UI at the origin root instead.
const openAllMusic = async (page: Page) => {
	await page.goto("#/all");
	await expect(
		page.getByRole("heading", { level: 1, name: "All music" }),
	).toBeVisible();
	await expect(trackRow(page, 0)).toBeAttached();
};

interface Seen {
	method: string;
	url: string;
}

// Anything that would edit a playlist: the six writes all go to /api/playlists by POST or DELETE.
const writesAsked = (seen: Seen[]) =>
	seen
		.filter(
			(one) =>
				one.method !== "GET" &&
				one.method !== "OPTIONS" &&
				one.url.includes("/api/playlists"),
		)
		.map((one) => `${one.method} ${one.url}`);

test.describe.configure({ mode: "serial" });

test("the component reports the setting off", async () => {
	const answer = await capabilities();
	console.log(`[c32] canWritePlaylists: ${answer.canWritePlaylists}`);
	expect(answer.canWritePlaylists).toBe(false);
});

test("the sidebar draws the playlists and no way to add, rename, delete or reorder one", async ({
	page,
}) => {
	const shown = (await playlists()).filter((entry) => entry.role === null);
	const first = shown[0];
	const second = shown[1];

	await seedToken(page);
	const seen: Seen[] = [];
	page.on("request", (request) =>
		seen.push({ method: request.method(), url: request.url() }),
	);

	await openAllMusic(page);
	await openSidebar(page);

	await expect(sidebarRow(page, first.title)).toBeVisible();
	await expect(page.getByRole("button", { name: "New playlist" })).toHaveCount(
		0,
	);
	console.log(`[c32] New playlist buttons: 0`);

	// The grip is aria-hidden, so it is found by its own class rather than by a role.
	const grips = sidebar(page).locator('[class*="grip"]');
	const gripCount = await grips.count();
	console.log(`[c32] reorder grips in the sidebar: ${gripCount}`);
	expect(gripCount).toBe(0);

	// Rename and Delete were the whole of a playlist row's menu, so with writes off the menu does
	// not open at all rather than opening empty.
	const row = sidebarRow(page, first.title);
	await row.click({ button: "right" });
	await page.waitForTimeout(1_000);
	const menus = await page.getByRole("menu").count();
	console.log(`[c32] menus opened by right-clicking a playlist row: ${menus}`);
	expect(menus).toBe(0);
	await expect(menuItem(page, "Rename")).toHaveCount(0);
	await expect(menuItem(page, "Delete")).toHaveCount(0);
	console.log(`[c32] Rename and Delete in a playlist's menu: 0`);

	// The keys, after the grip: a drag and Alt+Arrow are the two ways a playlist moves.
	const onto = sidebarRow(page, second.title);
	const from = (await row.boundingBox()) as {
		x: number;
		y: number;
		width: number;
		height: number;
	};
	const to = (await onto.boundingBox()) as {
		x: number;
		y: number;
		width: number;
		height: number;
	};
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.75, {
		steps: 12,
	});
	await page.mouse.up();

	const focusable = sidebar(page)
		.getByRole("button", {
			name: new RegExp(first.title.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&")),
		})
		.first();
	await focusable.focus();
	await page.keyboard.press("Alt+ArrowDown");
	await page.waitForTimeout(2_000);

	const order = (await playlists()).map((entry) => entry.title);
	console.log(
		`[c32] playlist writes asked: ${JSON.stringify(writesAsked(seen))}`,
	);
	console.log(`[c32] order unchanged: ${order[first.index] === first.title}`);
	expect(writesAsked(seen)).toEqual([]);
	expect(order[first.index]).toBe(first.title);
});

test("a track cannot be dropped onto a playlist and has nowhere to be filed", async ({
	page,
}) => {
	const shown = (await playlists()).filter((entry) => entry.role === null);
	const target = shown.find((entry) => !entry.isAutoPlaylist) ?? shown[0];

	await seedToken(page);
	const seen: Seen[] = [];
	page.on("request", (request) =>
		seen.push({ method: request.method(), url: request.url() }),
	);

	await openAllMusic(page);
	await openSidebar(page);

	const row = sidebarRow(page, target.title);
	await dragFrom(page, trackRow(page, 2), row);

	// `data-receiving` is what says the drag reached the sidebar at all, so a missing drop target
	// is a refusal rather than a gesture that never started.
	await expect(sidebar(page)).toHaveAttribute("data-receiving", "true");
	const dropTarget = await row.getAttribute("data-drop-target");
	const dropOver = await row.getAttribute("data-drop-over");
	console.log(
		`[c32] data-drop-target: ${dropTarget}, data-drop-over: ${dropOver}`,
	);
	expect(dropTarget).toBeNull();
	expect(dropOver).toBeNull();
	await page.mouse.up();

	await trackRow(page, 2).click({ button: "right" });
	await expect(menuItem(page, "Add to queue")).toBeVisible();
	await expect(menuItem(page, /Add to playlist/)).toHaveCount(0);
	console.log(`[c32] Add to playlist in a track's menu: 0`);
	await page.keyboard.press("Escape");

	await page.waitForTimeout(2_000);
	console.log(
		`[c32] playlist writes asked: ${JSON.stringify(writesAsked(seen))}`,
	);
	expect(writesAsked(seen)).toEqual([]);
});

test("search results keep Play and draw no Save as playlist", async ({
	page,
}) => {
	await seedToken(page);
	await openAllMusic(page);
	await searchFor(page, QUERY);

	await expect(
		viewHeader(page).getByRole("button", { name: "Play", exact: true }),
	).toBeVisible();
	const saveAs = viewHeader(page).getByRole("button", {
		name: /Save as playlist/,
	});
	console.log(`[c32] Save as playlist buttons: ${await saveAs.count()}`);
	await expect(saveAs).toHaveCount(0);
});
