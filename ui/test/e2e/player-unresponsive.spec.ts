import { UNRESPONSIVE_AFTER_MS } from "../../src/domain/player/connection.ts";
import { en } from "../../src/shared/i18n/en.ts";
import type { Page } from "./fixtures.ts";
import { expect, playFirstRow, test, toastRegion } from "./fixtures.ts";

// `foo_jean` answers `GET /api/state` from its own store, so while foobar2000's
// main thread is held by a modal dialog, a scan or a hung DSP the poll goes on
// landing and every command waits out the component's timeout. Without this the
// screen looks healthy while nothing the user presses does anything.

const HEADLINE = en["connection.unresponsive"];
const REMEDY = en["connection.unresponsiveRemedy"];
const UNRESPONSIVE_TITLE = `${en["player.unresponsive"]} · Jean`;

const notice = (page: Page) => toastRegion(page).filter({ hasText: HEADLINE });

// Resolves once the page has been handed a poll reporting the stall, rather
// than once one was asked, so the stall is known to have reached Jean.
const stallReported = (page: Page) =>
	page.waitForResponse(
		async (response) =>
			response.url().includes("/api/state") &&
			response.status() === 200 &&
			(await response.json()).mainThread.answering === false,
	);

// Records whether the notice or its title was ever drawn, since a flash between
// two samples is exactly what a polled assertion would miss.
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
		[HEADLINE, UNRESPONSIVE_TITLE] as const,
	);

const wasAlarmed = (page: Page) =>
	page.evaluate(
		() =>
			(window as unknown as { __alarm: { alarmed: boolean } }).__alarm.alarmed,
	);

test.describe("foobar2000's main thread not answering", () => {
	test("says foobar2000 is not responding and what may be holding it, then clears once it answers", async ({
		page,
		player,
		isMobile,
	}) => {
		await playFirstRow(page, isMobile);

		player.fooJean.mainThreadStalled = true;

		await expect(notice(page)).toBeVisible();
		await expect(notice(page)).toContainText(REMEDY);
		await expect(page).toHaveTitle(UNRESPONSIVE_TITLE);

		player.fooJean.mainThreadStalled = false;

		await expect(notice(page)).toHaveCount(0);
		await expect(page).toHaveTitle(/^Los Calientes/);
	});

	test("a stall reported for a single poll draws nothing", async ({
		page,
		player,
		isMobile,
	}) => {
		await playFirstRow(page, isMobile);
		await watchForAlarm(page);

		const reported = stallReported(page);
		player.fooJean.mainThreadStalled = true;
		await reported;
		player.fooJean.mainThreadStalled = false;

		// Past the point the notice would have appeared had the stall gone on.
		await page.waitForTimeout(UNRESPONSIVE_AFTER_MS + 1500);

		expect(await wasAlarmed(page)).toBe(false);
		await expect(notice(page)).toHaveCount(0);
		await expect(page).toHaveTitle(/^Los Calientes/);
	});
});
