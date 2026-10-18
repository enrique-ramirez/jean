import {
	expect,
	nowPlayingScreen,
	openLibrary,
	openNowPlaying,
	rowByTitle,
	test,
} from "./fixtures.ts";
import { scrollUntilMounted } from "./scrolling.ts";

// Jar Of Flies, retagged: 'No Excuses' credits two names the library knows on
// their own, Alice in Chains through the album artist and Mad Season through
// "Don't Follow". The comma is the tag's, and could as well be a name's.
const LEAD = "Alice in Chains";
const OTHER = "Mad Season";
const SHARED = "No Excuses";

test.describe("a credit naming two artists the library knows", () => {
	test.use({
		retagged: {
			[SHARED]: { "%artist%": `${LEAD}, ${OTHER}` },
			"Don't Follow": { "%artist%": OTHER },
		},
	});

	test("the screen links each of them and keeps the tag's own joiner", async ({
		page,
		isMobile,
	}) => {
		await openLibrary(page);
		await scrollUntilMounted(page, rowByTitle(page, SHARED));
		if (isMobile) await rowByTitle(page, SHARED).tap();
		else await rowByTitle(page, SHARED).dblclick();
		await openNowPlaying(page);

		const screen = nowPlayingScreen(page);
		const lead = screen.getByRole("link", { name: LEAD, exact: true });
		const other = screen.getByRole("link", { name: OTHER, exact: true });
		await expect(lead).toBeVisible();
		await expect(other).toBeVisible();
		await expect(lead).toHaveAttribute("href", /#\/artist\//);
		await expect(other).toHaveAttribute("href", /#\/artist\//);

		await expect(
			screen.locator("p", {
				has: page.getByRole("link", { name: OTHER, exact: true }),
			}),
		).toHaveText(`${LEAD}, ${OTHER}`);
	});
});
