import {
	expect,
	expectSettlesAt,
	globalControls,
	openLibrary,
	requestsTo,
	statusBar,
	test,
	trackRow,
} from "./fixtures.ts";

test("every POST a session sends says it is JSON, the body-less commands included", async ({
	page,
	player,
	isMobile,
}) => {
	const posted: { url: string; contentType: string | null }[] = [];
	page.on("request", (request) => {
		if (request.method() !== "POST") return;
		void request.headerValue("content-type").then((contentType) => {
			posted.push({ url: new URL(request.url()).pathname, contentType });
		});
	});

	await openLibrary(page);
	if (isMobile) await trackRow(page, 0).tap();
	else await trackRow(page, 0).dblclick();
	await expect(statusBar(page)).toContainText("Los Calientes");

	const transport = await globalControls(page, isMobile);
	for (const [control, route] of [
		["Pause", "/api/playback/play-pause"],
		["Next track", "/api/playback/next"],
		["Previous track", "/api/playback/previous"],
	] as const) {
		await transport.getByRole("button", { name: control, exact: true }).click();
		await expect.poll(() => requestsTo(player, route).length).toBe(1);
	}

	const notJson = () =>
		posted
			.filter(
				({ contentType }) =>
					!contentType?.toLowerCase().startsWith("application/json"),
			)
			.map(({ url }) => url);
	await expectSettlesAt(player, notJson, []);
});
