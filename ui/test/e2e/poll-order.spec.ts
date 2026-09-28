import type { Request } from "@playwright/test";
import type { FakePlayer, Page } from "./fixtures.ts";
import {
	expect,
	holdRequests,
	openLibrary,
	requestsTo,
	statusBar,
	test,
	titlesIn,
	trackRow,
} from "./fixtures.ts";

// Two reads of the player can be out at once: the tick, and the read a skip or a
// queue edit asks for itself so the screen need not wait for the next tick. On a
// LAN either can be the slow one, so an answer can land after one the player gave
// later. Whichever lands last, the screen has to end up showing the newer.

const isStateRead = (request: Request) =>
	new URL(request.url()).pathname === "/api/state";

// Every tick after the first carries the validator it was last answered with; a
// read asked for outside the tick carries none.
const isTick = (request: Request) =>
	isStateRead(request) && Boolean(request.headers()["if-none-match"]);

const isOwnRead = (request: Request) =>
	isStateRead(request) && !request.headers()["if-none-match"];

const ticksTaken = (player: FakePlayer) =>
	requestsTo(player, "/api/state").filter((one) => one.method === "GET").length;

const nextTrack = (page: Page) =>
	statusBar(page).getByRole("button", { name: /^Next track\b/ });

// Counted from inside the page, so a title drawn for one frame between two
// samples is still seen.
const watchTheStatusBarFor = (page: Page, title: string) =>
	page.evaluate((title) => {
		const seen = { times: 0 };
		(window as unknown as { __seen: typeof seen }).__seen = seen;
		const footer = document.querySelector("footer") as HTMLElement;
		new MutationObserver(() => {
			if (footer.textContent?.includes(title)) seen.times += 1;
		}).observe(footer, { subtree: true, childList: true, characterData: true });
	}, title);

const timesSeen = (page: Page) =>
	page.evaluate(
		() => (window as unknown as { __seen: { times: number } }).__seen.times,
	);

// Two whole ticks after a late answer is let go: one for a screen that took it to
// put it right, and one to show it stayed put.
const twoMoreTicks = async (player: FakePlayer) => {
	const taken = ticksTaken(player);
	await expect.poll(() => ticksTaken(player)).toBeGreaterThan(taken + 1);
};

// One tick asked for while the screen shows what it shows now, answered by the
// player once `change` has been made there, and then held. Two holds compose into
// that: the outer one stops the tick on its way out, and letting it go hands it to
// the inner one, which asks the player and keeps the answer. `armed` keeps a tick
// already on its way from being caught by the inner hold alone.
const tickAnsweredAfter = async (page: Page, change: () => void) => {
	let armed = false;
	const answer = await holdRequests(
		page,
		(request) => armed && isTick(request),
		{ answered: true, count: 1 },
	);
	const ask = await holdRequests(page, isTick, { count: 1 });
	armed = true;

	await ask.untilHeld();
	change();
	ask.release();
	await answer.untilHeld();
	return answer;
};

test.describe("answers arriving in a different order to the one they were asked in", () => {
	test.beforeEach(({ isMobile }) => {
		test.skip(
			isMobile,
			"the order answers land in is the poll's, and a phone polls the same way",
		);
	});

	test("a skip's own read answered late does not put back a track the player has moved past", async ({
		page,
		player,
	}) => {
		const [first, second, third] = titlesIn(player, "p7");
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect(statusBar(page)).toContainText(first);

		const skipRead = await holdRequests(page, isOwnRead, {
			answered: true,
			count: 1,
		});
		await nextTrack(page).click();
		await skipRead.untilHeld();
		await expect(statusBar(page)).toContainText(second);

		player.next();
		await expect(statusBar(page)).toContainText(third);

		await watchTheStatusBarFor(page, second);
		skipRead.release();
		await twoMoreTicks(player);

		expect(await timesSeen(page)).toBe(0);
		await expect(statusBar(page)).toContainText(third);
	});

	test("a tick answered late does not put back a track a skip has already moved past", async ({
		page,
		player,
	}) => {
		const [first, second, third] = titlesIn(player, "p7");
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		await expect(statusBar(page)).toContainText(first);

		const lateTick = await tickAnsweredAfter(page, () => player.next());
		await nextTrack(page).click();
		await expect(statusBar(page)).toContainText(third);

		await watchTheStatusBarFor(page, second);
		lateTick.release();
		await twoMoreTicks(player);

		expect(await timesSeen(page)).toBe(0);
		await expect(statusBar(page)).toContainText(third);
	});
});
