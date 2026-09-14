import {
	dropTheStream,
	expect,
	globalControls,
	openLibrary,
	test,
	trackRow,
} from "./fixtures.ts";

// What the player is doing arrives on the component's poll and recovers there.
// beefweb's narrowed subscription carries the playlist list and the play queue,
// and those two recover for free because EventSource reconnects by itself and
// beefweb replays a full snapshot of whatever was subscribed to.
test.describe("the update stream going away", () => {
	test("a playlist changed while it was gone still shows up", async ({
		page,
		player,
	}) => {
		await openLibrary(page);
		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "54");

		await dropTheStream(page);

		player.copyItems("p5", "p7", [0]);
		player.notifyPlaylists();

		await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "55");
	});

	test("a track queued while it was gone still shows up", async ({
		page,
		player,
		isMobile,
	}) => {
		await openLibrary(page);
		await trackRow(page, 0).dblclick();
		const queue = (await globalControls(page, isMobile)).getByRole("button", {
			name: /^Queue/,
		});
		await expect(queue).toHaveAccessibleName("Queue");

		await dropTheStream(page);

		// Queued at the desktop, so nothing Jean did can be what brings it back.
		expect(player.queueAdd("p7", 3)).toBe(true);

		await expect(queue).toHaveAccessibleName("Queue, 1 track");
	});
});
