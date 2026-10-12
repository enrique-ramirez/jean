import type { DetachedSession } from "../fake-api/sessions.ts";
import type { Track } from "../fake-api/state.ts";
import {
	drawing,
	expect,
	type FakePlayer,
	type Locator,
	type Page,
	pickerOpener,
	playingOn,
	test,
	titleOf,
	tokenColourIn,
	untilQuiet,
} from "./fixtures.ts";
import {
	ANOTHER_DEVICE,
	castOf,
	closePicker,
	currentRows,
	DEVICE,
	everShown,
	expectStillOpen,
	inStartedSession,
	KITCHEN,
	LISTENING_HERE,
	leaveButton,
	morePolls,
	OFFERING_SESSIONS,
	ON_THE_PLAYER,
	openPicker,
	ownRow,
	playerRowOf,
	ROUTE_WITH_NO_LIST,
	recordEveryToast,
	refusalsFrom,
	STARTED_HERE,
	skipped,
	statePolls,
	storeForThisTab,
	strictOnceSettled,
	thePlayersFace,
	toastSaying,
	watchFor,
} from "./sessions.ts";

const WITHOUT_EFFECTS =
	/^Playing without foobar2000['’]s effects, because one of them failed\.$/;
const WITHOUT_EFFECTS_OPENING = "Playing without foobar2000";

const REPORTED_FIRST = "The Future";
const REPORTED_SECOND = "Deep, Deep";

// Tracks foobar2000 played from outside its media library, so `foo_jean` reports them with a `path`
// and no `libraryPath`.
const OFF_THE_LIBRARY: Track = {
	"%path%": "C:\\Elsewhere\\Dragged in\\07. Not In The Library.flac",
	"%subsong%": "0",
};
const WITH_NO_DIRECTORY: Track = {
	"%path%": "Loose Track.flac",
	"%subsong%": "0",
};
const SKIPPED_OFF_THE_LIBRARY =
	/^Could not play “07\. Not In The Library(\.flac)?”, so it was skipped\.$/;
const SKIPPED_WITH_NO_DIRECTORY =
	/^Could not play “Loose Track(\.flac)?”, so it was skipped\.$/;

const libraryTrackTitled = (player: FakePlayer, title: string) => {
	const track = player
		.playlistById("p7")
		?.items.find((held) => titleOf(held) === title);
	if (!track || player.libraryPathFor(track) === null)
		throw new Error(`the library holds no "${title}"`);
	return track;
};

const skippedToastsRaised = (page: Page) =>
	page.evaluate(() =>
		(window as unknown as { everyToast: string[] }).everyToast.filter((said) =>
			said.includes("skipped"),
		),
	);

const documentReads = (player: FakePlayer, session: DetachedSession) =>
	player.requests.filter(
		(entry) =>
			entry.method === "GET" &&
			entry.path.split("?")[0] === `/api/sessions/${session.id}`,
	).length;

const moreDocumentReads = async (
	player: FakePlayer,
	session: DetachedSession,
	count: number,
) => {
	const from = documentReads(player, session);
	await expect
		.poll(() => documentReads(player, session))
		.toBeGreaterThanOrEqual(from + count);
};

const expectErrorTone = async (toast: Locator) => {
	const danger = await tokenColourIn(toast, "--danger");
	await expect
		.poll(() =>
			toast
				.locator("svg")
				.evaluateAll((svgs) =>
					svgs.map((svg) => [
						svg.getAttribute("class") ?? "",
						getComputedStyle(svg).stroke,
					]),
				),
		)
		.toContainEqual([expect.stringMatching(drawing("triangle-alert")), danger]);
};

test.describe("a track the session this page listens to could not play", () => {
	test.use(OFFERING_SESSIONS);

	test(`with the picker closed, raises one toast "${skipped("{title}")}" in the error tone, naming the track by the title the library holds for its path`, async ({
		page,
		player,
		isMobile,
	}) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);
		await untilQuiet(player);

		player.addSessionReport(
			started.id,
			libraryTrackTitled(player, REPORTED_SECOND),
		);

		const toast = toastSaying(page, skipped(REPORTED_SECOND));
		await expect(toast).toBeVisible();
		await expectErrorTone(toast);
		await untilQuiet(player);
		expect(await skippedToastsRaised(page)).toEqual([skipped(REPORTED_SECOND)]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("names a track the library does not hold by its file's name, whether its path has directories or none", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);
		await untilQuiet(player);

		player.addSessionReport(started.id, OFF_THE_LIBRARY);
		await expect.poll(() => skippedToastsRaised(page)).toHaveLength(1);
		player.addSessionReport(started.id, WITH_NO_DIRECTORY);
		await expect.poll(() => skippedToastsRaised(page)).toHaveLength(2);

		await untilQuiet(player);
		expect(await skippedToastsRaised(page)).toEqual([
			expect.stringMatching(SKIPPED_OFF_THE_LIBRARY),
			expect.stringMatching(SKIPPED_WITH_NO_DIRECTORY),
		]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("two reports read together raise two toasts, one each, in the order they were reported", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);
		await untilQuiet(player);
		const reads = documentReads(player, started);

		player.addSessionReport(
			started.id,
			libraryTrackTitled(player, REPORTED_FIRST),
		);
		player.addSessionReport(
			started.id,
			libraryTrackTitled(player, REPORTED_SECOND),
		);

		await expect.poll(() => skippedToastsRaised(page)).toHaveLength(2);
		await untilQuiet(player);
		expect(documentReads(player, started)).toBe(reads + 1);
		expect(await skippedToastsRaised(page)).toEqual([
			skipped(REPORTED_FIRST),
			skipped(REPORTED_SECOND),
		]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("raises it once: not again on later reads of the document, nor after a reload", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);
		await untilQuiet(player);
		player.addSessionReport(
			started.id,
			libraryTrackTitled(player, REPORTED_SECOND),
		);
		await expect(toastSaying(page, skipped(REPORTED_SECOND))).toBeVisible();

		started.share(true);
		await moreDocumentReads(player, started, 1);
		started.share(false);
		await moreDocumentReads(player, started, 1);
		await morePolls(player, 2);
		await untilQuiet(player);
		expect(await skippedToastsRaised(page)).toEqual([skipped(REPORTED_SECOND)]);

		const reads = documentReads(player, started);
		await page.reload();
		await expect(pickerOpener(page)).toHaveAccessibleName(STARTED_HERE);
		await expect
			.poll(() => documentReads(player, started))
			.toBeGreaterThan(reads);
		await morePolls(player, 2);
		await untilQuiet(player);
		expect(started.reports).toHaveLength(1);
		expect(await skippedToastsRaised(page)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("with the picker open, raises the toast and leaves the picker open", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await untilQuiet(player);

		player.addSessionReport(
			started.id,
			libraryTrackTitled(player, REPORTED_SECOND),
		);

		await expect(toastSaying(page, skipped(REPORTED_SECOND))).toBeVisible();
		await untilQuiet(player);
		await expectStillOpen(page, isMobile);
		expect(await skippedToastsRaised(page)).toEqual([skipped(REPORTED_SECOND)]);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("reports already in a session's document when the page enters it", () => {
	test.use(OFFERING_SESSIONS);

	test("raise nothing, and a report made after the page entered raises one", async ({
		page,
		player,
	}) => {
		await recordEveryToast(page);
		const session = player.sessions.create({
			deviceId: ANOTHER_DEVICE.deviceId,
			name: KITCHEN,
		});
		session.join(DEVICE);
		player.addSessionReport(
			session.id,
			libraryTrackTitled(player, REPORTED_FIRST),
		);
		player.addSessionReport(session.id, OFF_THE_LIBRARY);
		await storeForThisTab(page, { id: session.id, listening: true });
		const refused = refusalsFrom(page);

		await page.goto(ROUTE_WITH_NO_LIST);
		await expect(pickerOpener(page)).toHaveAccessibleName(
			`Playing what ${KITCHEN} started`,
		);
		const strict = await strictOnceSettled(player);
		await morePolls(player, 2);
		await untilQuiet(player);
		expect(await skippedToastsRaised(page)).toEqual([]);

		player.addSessionReport(
			session.id,
			libraryTrackTitled(player, REPORTED_SECOND),
		);
		await expect(toastSaying(page, skipped(REPORTED_SECOND))).toBeVisible();
		await untilQuiet(player);
		expect(await skippedToastsRaised(page)).toEqual([skipped(REPORTED_SECOND)]);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("two pages of one browser showing one session", () => {
	test.use(OFFERING_SESSIONS);

	test("each raise a report once", async ({ page, player }) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		const beside = await page.context().newPage();
		await recordEveryToast(beside);
		await storeForThisTab(beside, { id: started.id, listening: true });
		const refusedBeside = refusalsFrom(beside);
		await beside.goto(ROUTE_WITH_NO_LIST);
		await expect(pickerOpener(beside)).toHaveAccessibleName(STARTED_HERE);
		await untilQuiet(player);

		player.addSessionReport(
			started.id,
			libraryTrackTitled(player, REPORTED_SECOND),
		);

		await expect(toastSaying(page, skipped(REPORTED_SECOND))).toBeVisible();
		await expect(toastSaying(beside, skipped(REPORTED_SECOND))).toBeVisible();
		await morePolls(player, 2);
		await untilQuiet(player);
		expect(await skippedToastsRaised(page)).toEqual([skipped(REPORTED_SECOND)]);
		expect(await skippedToastsRaised(beside)).toEqual([
			skipped(REPORTED_SECOND),
		]);
		strict.release();
		expect(refused).toEqual([]);
		expect(refusedBeside).toEqual([]);
	});
});

const chainDroppedUnder = async (
	player: FakePlayer,
	session: DetachedSession,
) => {
	const cast = castOf(player);
	session.play([cast.inTheSession, cast.nextInTheSession], 0);
	await untilQuiet(player);
	player.dropSessionChain(session.id);
	await moreDocumentReads(player, session, 1);
};

test.describe("while the session's document reads chainDropped", () => {
	test.use(OFFERING_SESSIONS);

	test("the row this tab is in says the session plays without foobar2000's effects, once and in no other row, and no toast says a track was skipped", async ({
		page,
		player,
		isMobile,
	}) => {
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);
		await chainDroppedUnder(player, started);

		await openPicker(page);
		await expect(playingOn(page).getByText(WITHOUT_EFFECTS)).toBeVisible();
		await expect(playingOn(page).getByText(WITHOUT_EFFECTS)).toHaveCount(1);
		await expect(currentRows(page).getByText(WITHOUT_EFFECTS)).toHaveCount(1);
		await expect(playerRowOf(page).getByText(WITHOUT_EFFECTS)).toHaveCount(0);
		await untilQuiet(player);
		expect(await skippedToastsRaised(page)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("the line still stands after a reload", async ({
		page,
		player,
		isMobile,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);
		await chainDroppedUnder(player, started);
		await openPicker(page);
		await expect(playingOn(page).getByText(WITHOUT_EFFECTS)).toBeVisible();

		await page.reload();
		await openPicker(page);

		await expect(currentRows(page).getByText(WITHOUT_EFFECTS)).toBeVisible();
		await expect(playingOn(page).getByText(WITHOUT_EFFECTS)).toHaveCount(1);
		strict.release();
		expect(refused).toEqual([]);
	});

	test("the line is never drawn while the document reads chainDropped false, though it holds a report", async ({
		page,
		player,
	}) => {
		await watchFor(page, [WITHOUT_EFFECTS_OPENING]);
		await recordEveryToast(page);
		const { strict, refused, started } = await inStartedSession(page, player);
		await untilQuiet(player);

		player.addSessionReport(
			started.id,
			libraryTrackTitled(player, REPORTED_SECOND),
		);
		await expect(toastSaying(page, skipped(REPORTED_SECOND))).toBeVisible();
		await untilQuiet(player);

		await expect(ownRow(page)).toContainText(LISTENING_HERE);
		expect(await everShown(page)).toEqual([]);
		strict.release();
		expect(refused).toEqual([]);
	});
});

test.describe("the without-effects line, once the page is back on the player", () => {
	test.use(OFFERING_SESSIONS);

	test("is gone from every row once the page leaves a session whose chain dropped", async ({
		page,
		player,
		isMobile,
	}) => {
		const { strict, refused, started } = await inStartedSession(page, player);
		await closePicker(page, isMobile);
		await chainDroppedUnder(player, started);
		await openPicker(page);
		await expect(playingOn(page).getByText(WITHOUT_EFFECTS)).toBeVisible();

		strict.release();
		await leaveButton(page).click();
		await expect(thePlayersFace(page)).toBeVisible();
		await expect.poll(() => statePolls(player).at(-1)).toEqual(ON_THE_PLAYER);
		await untilQuiet(player);

		expect(await playingOn(page).getByText(WITHOUT_EFFECTS).count()).toBe(0);
		expect(refused).toEqual([]);
	});
});
