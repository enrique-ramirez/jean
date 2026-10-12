import {
	RECONNECTING_AFTER_MS,
	REMEDY_AFTER_MS,
} from "../../src/domain/player/connection.ts";
import { en } from "../../src/shared/i18n/en.ts";
import type { Page } from "./fixtures.ts";
import {
	expect,
	playFirstRow,
	statusBar,
	test,
	toastRegion,
} from "./fixtures.ts";

const RECONNECTING = en["connection.reconnecting"];
const REMEDY = en["connection.remedy"];
const DISCONNECTED_TITLE = `${en["player.disconnected"]} · Jean`;

const notice = (page: Page) =>
	toastRegion(page).filter({ hasText: RECONNECTING });

const setReachable = async (page: Page, reachable: boolean) => {
	const answered = await page.request.post("/__control/reachable", {
		data: { reachable },
	});
	expect(answered.ok(), "the fake needs /__control/reachable").toBe(true);
};

const countFailedPolls = (page: Page) => {
	const failed: string[] = [];
	page.on("requestfailed", (request) => {
		if (request.url().includes("/api/state")) failed.push(request.url());
	});
	return failed;
};

// Records whether the notice or the disconnected title was ever drawn, since a
// flash between two samples is exactly what a polled assertion would miss.
const watchForAlarm = (page: Page) =>
	page.evaluate(
		([text, title]) => {
			const seen = { alarmed: false };
			(window as unknown as { __alarm: typeof seen }).__alarm = seen;
			const check = () => {
				if (
					document.title === title ||
					document.body.textContent?.includes(text)
				)
					seen.alarmed = true;
			};
			new MutationObserver(check).observe(document, {
				subtree: true,
				childList: true,
				characterData: true,
			});
		},
		[RECONNECTING, DISCONNECTED_TITLE] as const,
	);

const wasAlarmed = (page: Page) =>
	page.evaluate(
		() =>
			(window as unknown as { __alarm: { alarmed: boolean } }).__alarm.alarmed,
	);

test.describe("losing the connection to foo_jean mid-session", () => {
	test("a poll or two lost on weak wifi draws nothing", async ({
		page,
		isMobile,
	}) => {
		await playFirstRow(page, isMobile);
		await watchForAlarm(page);

		const failedPolls = countFailedPolls(page);

		await setReachable(page, false);
		await expect.poll(() => failedPolls.length).toBeGreaterThanOrEqual(1);
		await setReachable(page, true);

		// Past the point the notice would have appeared had the drop gone on.
		await page.waitForTimeout(RECONNECTING_AFTER_MS + 1500);

		expect(await wasAlarmed(page)).toBe(false);
		await expect(notice(page)).toHaveCount(0);
		await expect(page).toHaveTitle(/^Los Calientes/);
	});

	test("says it is reconnecting, then what to check, and clears itself once the player answers", async ({
		page,
		player,
		isMobile,
	}) => {
		test.setTimeout(REMEDY_AFTER_MS + 40_000);
		await playFirstRow(page, isMobile);

		const failedPolls = countFailedPolls(page);
		await setReachable(page, false);

		await expect.poll(() => failedPolls.length).toBeGreaterThanOrEqual(1);
		await expect(notice(page)).toHaveCount(0);
		await expect(notice(page)).toBeVisible();
		await expect(page).toHaveTitle(DISCONNECTED_TITLE);
		await expect(notice(page)).not.toContainText(REMEDY);

		// Driven at the desktop while Jean cannot see it, so the screen can only
		// catch up by reading the player again once it is back.
		player.playItem("p7", 1);

		await expect(notice(page)).toContainText(REMEDY, {
			timeout: REMEDY_AFTER_MS + 5000,
		});
		await expect(page).toHaveTitle(DISCONNECTED_TITLE);

		await setReachable(page, true);

		await expect(notice(page)).toHaveCount(0);
		await expect(statusBar(page)).toContainText("Fizz");
		await expect(page).toHaveTitle(/^Fizz/);
	});
});
