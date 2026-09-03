import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// Detection only: nothing is wired to the source yet, so this checks the seam
// before the call sites move onto it.

const info = async (request: APIRequestContext) =>
	(await request.get("/api/library/info")).json();

// Every test takes `player` even where it goes unread: it is the fixture that
// applies `test.use({ library })`, and Playwright only builds what a test asks
// for.

test.describe("a player with the media library API", () => {
	// Pinned, so this still describes the supported case on a fallback run.
	test.use({ library: { supported: true, enabled: true } });

	test("it reports supported and enabled, with a count", async ({
		request,
		player,
	}) => {
		const { library } = await info(request);

		expect(library!.supported).toBe(true);
		expect(library!.enabled).toBe(true);
		expect(library!.itemCount).toBe(
			player.playlists.find((p) => p.title === "Library")!.items.length,
		);
	});
});

test.describe("a player without it", () => {
	test.use({ library: { supported: false } });

	test("detection still answers when there is no API", async ({
		request,
		player,
	}) => {
		const { library } = await info(request);
		expect(library!.supported).toBe(false);
	});
});

test.describe("a player whose library is switched off", () => {
	test.use({ library: { supported: true, enabled: false } });

	test("it is a different state from having no API", async ({
		request,
		player,
	}) => {
		const { library } = await info(request);

		// The distinction decides what is offered: make an autoplaylist, or switch
		// the media library on in foobar2000.
		expect(library!.supported).toBe(true);
		expect(library!.enabled).toBe(false);
	});
});
