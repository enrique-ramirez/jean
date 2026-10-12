import type { FakePlayer, Locator, Page } from "./fixtures.ts";
import {
	countPostsTo,
	deviceAudio,
	expect,
	expectDisabledWithReason,
	expectNothingOpened,
	expectSettlesAt,
	listenHere,
	nowPlayingScreen,
	openNowPlaying,
	orderButton,
	pickerOpener,
	playingAtThePlayer,
	playingOn,
	REASON,
	refusedAsks,
	statusBar,
	test,
	trackRow,
	untilQuiet,
} from "./fixtures.ts";
import { dragTo, touchDrag } from "./gestures.ts";

test.describe("listening on this device with playback control off at the player", () => {
	test.use({ fooJean: { canControlPlayback: false } });

	const showVolume = (scope: Locator) =>
		scope.getByRole("button", { name: "Show volume" });

	const faderIn = (scope: Locator) =>
		scope.getByRole("slider", { name: /^Volume\b/ });

	const listeningHere = async (page: Page, player: FakePlayer) => {
		await playingAtThePlayer(page, player);
		await listenHere(page);
		await page.keyboard.press("Escape");
		await expect(playingOn(page)).toBeHidden();
		await expect(pickerOpener(page)).toHaveAccessibleName(
			/Playing on this device/,
		);
		await untilQuiet(player);
		return player.requests.length;
	};

	const pressFromTheBody = async (page: Page, keys: readonly string[]) => {
		// Space on a focused button presses the button.
		await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
		for (const key of keys) await page.keyboard.press(key);
	};

	const slide = async (
		page: Page,
		isMobile: boolean,
		fader: Locator,
		from: number,
		to: number,
	) => {
		const box = (await fader.boundingBox())!;
		const vertical = box.height > box.width;
		const at = (fraction: number) =>
			vertical
				? { x: box.x + box.width / 2, y: box.y + box.height * (1 - fraction) }
				: { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
		if (isMobile) {
			await touchDrag(page, at(from), at(to), 8);
			return;
		}
		await page.mouse.move(at(from).x, at(from).y);
		await page.mouse.down();
		await page.mouse.move(at(to).x, at(to).y, { steps: 10 });
		await page.mouse.up();
	};

	const expectTurnsThisDevice = async (
		page: Page,
		isMobile: boolean,
		fader: Locator,
		from: number,
		to: number,
	) => {
		await expect(fader).toBeVisible();
		await expect(fader).not.toHaveAttribute("aria-disabled", "true");
		await expect(fader).toHaveAccessibleName("Volume on this device");

		const before = (await deviceAudio(page)).volume;
		await slide(page, isMobile, fader, from, to);
		const now = async () => (await deviceAudio(page)).volume;
		if (to < from) await expect.poll(now).toBeLessThan(before - 0.1);
		else await expect.poll(now).toBeGreaterThan(before + 0.1);
	};

	test("every volume fader drawn is enabled, and moving it turns this device's volume and sends the player none", async ({
		page,
		player,
		isMobile,
	}) => {
		await listeningHere(page, player);
		const bar = statusBar(page);

		if (isMobile) await showVolume(bar).click();
		await expectTurnsThisDevice(page, isMobile, faderIn(bar), 0.9, 0.2);

		if (isMobile) {
			await page.keyboard.press("Escape");
			await openNowPlaying(page);
			const screen = nowPlayingScreen(page);
			await showVolume(screen).click();
			await expectTurnsThisDevice(page, isMobile, faderIn(screen), 0.2, 0.9);
		}

		await expectSettlesAt(player, () => countPostsTo(player, "/api/volume"), 0);
	});

	test("the player's own fader under Listen here stays disabled with the reason, and moving it sends no volume", async ({
		page,
		player,
		isMobile,
	}) => {
		await listeningHere(page, player);
		await pickerOpener(page).click();
		const fader = playingOn(page).getByRole("slider", {
			name: /^Volume on foobar2000\b/,
		});

		await expectDisabledWithReason(fader);

		await fader.click({ force: true });
		if (!isMobile) await dragTo(page, fader, 0.6);
		await expectSettlesAt(player, () => countPostsTo(player, "/api/volume"), 0);
	});

	test("the volume keys turn and mute this device, and send nothing the player would refuse", async ({
		page,
		player,
		isMobile,
	}) => {
		test.skip(isMobile, "no keyboard on the phone");

		const since = await listeningHere(page, player);
		const volume = async () => (await deviceAudio(page)).volume;
		const isMuted = async () => (await deviceAudio(page)).isMuted;

		const full = await volume();
		await pressFromTheBody(page, ["-"]);
		await expect.poll(volume).toBeLessThan(full);
		const lowered = await volume();
		await pressFromTheBody(page, ["="]);
		await expect.poll(volume).toBeGreaterThan(lowered);

		await pressFromTheBody(page, ["m"]);
		await expect.poll(isMuted).toBe(true);
		await pressFromTheBody(page, ["m"]);
		await expect.poll(isMuted).toBe(false);

		await expectSettlesAt(player, () => refusedAsks(player, since), []);
	});

	for (const isListening of [true, false])
		test(`the transport keys, s and o send nothing, and o opens no list, ${isListening ? "listening here" : "with nothing listening"}`, async ({
			page,
			player,
			isMobile,
		}) => {
			test.skip(isMobile, "no keyboard on the phone");

			const since = isListening
				? await listeningHere(page, player)
				: await playingAtThePlayer(page, player).then(() => 0);

			await pressFromTheBody(page, [
				"Space",
				"ControlOrMeta+ArrowRight",
				"ControlOrMeta+ArrowLeft",
				"ControlOrMeta+.",
				"ArrowRight",
				"ArrowLeft",
			]);
			await trackRow(page, 4).click();
			await page.keyboard.press("s");
			await expect(orderButton(page, false)).toHaveAttribute(
				"aria-disabled",
				"true",
			);
			// Last, with nothing pressed after it: a click on a row would dismiss a list it had
			// opened.
			await pressFromTheBody(page, ["o"]);

			await expectSettlesAt(player, () => refusedAsks(player, since), []);
			await expectNothingOpened(page);
		});

	test("the status bar, and a phone's now-playing screen, still say why once", async ({
		page,
		player,
		isMobile,
	}) => {
		await listeningHere(page, player);

		const line = statusBar(page).getByText(REASON);
		await expect(line).toHaveCount(1);
		await expect(line).toBeVisible();

		if (isMobile) {
			await openNowPlaying(page);
			const onScreen = nowPlayingScreen(page).getByText(REASON);
			await expect(onScreen).toHaveCount(1);
			await expect(onScreen).toBeVisible();
		}
	});
});

test.describe("the phone's volume faders with playback control off at the player and nothing listening", () => {
	test.use({ fooJean: { canControlPlayback: false } });
	test.skip(
		({ isMobile }) => !isMobile,
		"the popover faders are compact-only; the wide status bar's is read-only-playback.spec.ts's",
	);

	test("the status bar's and the now-playing screen's faders are disabled with the reason, and moving them sends no volume", async ({
		page,
		player,
	}) => {
		await playingAtThePlayer(page, player);
		const bar = statusBar(page);
		await bar.getByRole("button", { name: "Show volume" }).click();
		const barFader = bar.getByRole("slider", { name: /^Volume\b/ });
		await expectDisabledWithReason(barFader);
		await barFader.click({ force: true });

		await page.keyboard.press("Escape");
		await openNowPlaying(page);
		const screen = nowPlayingScreen(page);
		await screen.getByRole("button", { name: "Show volume" }).click();
		const screenFader = screen.getByRole("slider", { name: /^Volume\b/ });
		await expectDisabledWithReason(screenFader);
		await screenFader.click({ force: true });

		await expectSettlesAt(player, () => countPostsTo(player, "/api/volume"), 0);
	});
});
