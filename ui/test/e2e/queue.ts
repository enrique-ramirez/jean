import type { Page } from "./fixtures.ts";
import {
	expect,
	nowPlayingScreen,
	openNowPlaying,
	statusBar,
} from "./fixtures.ts";

export const queuePanel = (page: Page) =>
	page.getByRole("complementary", { name: "Queue" });

export const queueRows = (page: Page) => queuePanel(page).getByRole("listitem");

export const queueButton = (page: Page) =>
	statusBar(page).getByRole("button", { name: /^Queue/ });

export const anyQueueButton = async (page: Page) => {
	if (await queueButton(page).count()) return queueButton(page);
	await openNowPlaying(page);
	return nowPlayingScreen(page).getByRole("button", { name: /^Queue/ });
};

// Closed, the panel is parked off the right edge rather than hidden, so
// `toBeHidden()` would not see it either way.
export const openQueue = async (page: Page) => {
	if ((await queuePanel(page).getAttribute("data-open")) !== "true")
		await (await anyQueueButton(page)).click();
	await expect(queuePanel(page)).toHaveAttribute("data-open", "true");
};
