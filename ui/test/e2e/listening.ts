import {
	expect,
	type FakePlayer,
	type Locator,
	type Page,
	pickerOpener,
	playingOn,
	requestsTo,
} from "./fixtures.ts";
import { listensIn, thePlayersFace } from "./sessions.ts";

export const TICK = [100, 100, 200];

export const currentTime = (page: Page) =>
	page.evaluate(() => {
		const audio = document.querySelector("audio");
		return audio ? audio.currentTime : null;
	});

export const streamRequests = (player: FakePlayer) =>
	player.requests.filter((entry) => entry.path.split("?")[0] === "/api/stream");

export const ticketRequests = (player: FakePlayer) =>
	requestsTo(player, "/api/stream/ticket").filter(
		(entry) => entry.method === "POST",
	);

// Choosing does not dismiss the panel -- the player's row is where the connection
// reports itself -- so every helper below leaves it open.
export const startListening = async (page: Page) => {
	await pickerOpener(page).click();
	await thePlayersFace(page).click();
};

// By its name rather than by its role: the face is a button only where pressing
// it would do something.
export const thePlayer = (page: Page) =>
	playingOn(page).getByText("foobar2000", { exact: true });

export const playerRow = (page: Page) =>
	playingOn(page)
		.getByRole("listitem")
		.filter({ has: page.getByText("foobar2000", { exact: true }) });

export const HAND_BACK = "Stop, and move the sound back to foobar2000";
export const STOP_HERE = "Stop listening here";

export const stopButtons = (page: Page) =>
	playingOn(page).getByRole("button", {
		name: new RegExp(`^(${HAND_BACK}|${STOP_HERE})$`),
	});

export const pickerPanel = (page: Page) => playingOn(page).locator("xpath=..");

export const playerFader = (page: Page) =>
	playingOn(page).getByRole("slider", { name: "Volume on foobar2000" });

// A mute on foobar2000 is its fader at the bottom of its travel, so a button for it would be a
// control that disappears at the one level somebody needs it at. Read once the fader beside where it
// would sit is drawn, so an empty count is about a panel that is on screen.
export const mutesInThePanel = async (page: Page) => {
	await expect(playerFader(page)).toBeVisible();
	const named = { name: /mute|silence/i };
	return pickerPanel(page)
		.getByRole("button", named)
		.or(pickerPanel(page).getByRole("switch", named))
		.or(pickerPanel(page).getByRole("checkbox", named))
		.count();
};

export const marks = (within: Locator) => within.locator("[data-paused]");

// Two tracks far enough apart in the Library fixture to have nothing in common.
export const HEARD = { index: 2, title: "Deléctrico" };

// Named the way foobar2000 lists outputs on Windows, with ids of the shape it answers.
export const SPEAKERS = {
	id: "5B0C0E5E-3C1D-4D6A-8E2F-1A2B3C4D5E6F:1F2E3D4C-5B6A-4978-8A9B-0C1D2E3F4A5B",
	name: "Speakers [WASAPI]",
};

export const listensInItsOwn = (player: FakePlayer) => {
	const [started, ...more] = player.sessions.list();
	return Boolean(started) && more.length === 0 && listensIn(started);
};
