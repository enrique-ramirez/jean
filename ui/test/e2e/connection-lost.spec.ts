import {
	RECONNECTING_AFTER_MS,
	REMEDY_AFTER_MS,
} from "../../src/domain/player/connection.ts";
import { en } from "../../src/shared/i18n/en.ts";
import type { Locator, Page } from "./fixtures.ts";
import {
	expect,
	nowPlayingScreen,
	openNowPlaying,
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

const UNREACHABLE = new RegExp(
	en["player.unreachableName"]
		.replace(/[()]/g, "\\$&")
		.replace("{control}", ".+"),
);

const position = (scope: Locator) =>
	scope.getByRole("slider", { name: /^Playback position\b/ });

const button = (scope: Locator, name: RegExp) =>
	scope.getByRole("button", { name });

const playToggle = (scope: Locator) => button(scope, /^(Play|Pause)\b/);

const transport = (scope: Locator) => [
	playToggle(scope),
	position(scope),
	button(scope, /^Playback order\b/),
	button(scope, /^Previous track\b/),
	button(scope, /^Next track\b/),
];

const statusBarControls = (page: Page, isCompact: boolean) => {
	const bar = statusBar(page);
	if (isCompact) return [playToggle(bar), position(bar)];
	return [
		...transport(bar),
		button(bar, /^(Mute|Unmute)\b/),
		bar.getByRole("slider", { name: /^Volume\b/ }),
	];
};

const CLOCK_TICKS_TWICE_MS = 2500;

const secondsShown = async (page: Page) =>
	Number(await position(statusBar(page)).getAttribute("aria-valuenow"));

const loseThePlayer = async (page: Page) => {
	await setReachable(page, false);
	await expect(notice(page)).toBeVisible();
};

const expectRefused = async (controls: Locator[]) => {
	for (const control of controls) {
		await expect(control).toHaveAttribute("aria-disabled", "true");
		await expect(control).toHaveAccessibleName(UNREACHABLE);
	}
};

const expectAllowed = async (controls: Locator[]) => {
	for (const control of controls) {
		await expect(control).not.toHaveAttribute("aria-disabled", "true");
		await expect(control).not.toHaveAccessibleName(UNREACHABLE);
	}
};

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

	test("the clock stops and the status bar dims while the player can't be reached, and both come back", async ({
		page,
		isMobile,
	}) => {
		await playFirstRow(page, isMobile);
		const bar = statusBar(page);
		const identity = bar.getByRole("button", { name: "Show current track" });
		await expect(identity).toHaveCSS("opacity", "1");

		await loseThePlayer(page);
		await expect(identity).not.toHaveCSS("opacity", "1");

		const frozenAt = await secondsShown(page);
		const elapsed = isMobile
			? null
			: bar.getByTitle(en["player.showRemaining"]);
		const frozenText = await elapsed?.textContent();
		await page.waitForTimeout(CLOCK_TICKS_TWICE_MS);
		expect(await secondsShown(page)).toBe(frozenAt);
		if (elapsed) expect(await elapsed.textContent()).toBe(frozenText);

		await setReachable(page, true);

		await expect(notice(page)).toHaveCount(0);
		await expect(identity).toHaveCSS("opacity", "1");
		await expect.poll(() => secondsShown(page)).toBeGreaterThan(frozenAt);
	});

	test("the status bar's transport is disabled, named with the reason, while the player can't be reached, and returns once it answers", async ({
		page,
		isMobile,
	}) => {
		await playFirstRow(page, isMobile);
		const controls = statusBarControls(page, isMobile);
		await expectAllowed(controls);

		await loseThePlayer(page);
		await expectRefused(controls);

		await setReachable(page, true);
		await expect(notice(page)).toHaveCount(0);
		await expectAllowed(controls);
	});

	test("the now-playing screen's transport is disabled with the reason while the player can't be reached, and returns once it answers", async ({
		page,
		isMobile,
	}) => {
		test.skip(
			!isMobile,
			"the screen draws a transport only on a phone; on a desktop the status bar is it",
		);
		await playFirstRow(page, isMobile);
		await openNowPlaying(page);
		const controls = transport(nowPlayingScreen(page));
		await expectAllowed(controls);

		await loseThePlayer(page);
		await expectRefused(controls);

		await setReachable(page, true);
		await expect(notice(page)).toHaveCount(0);
		await expectAllowed(controls);
	});
});
