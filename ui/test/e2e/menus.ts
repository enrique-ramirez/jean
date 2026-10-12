import type { Page } from "./fixtures.ts";
import { expect, trackRow } from "./fixtures.ts";
import { pressAndHold } from "./gestures.ts";

export const openRowMenu = async (
	page: Page,
	isMobile: boolean,
	index: number,
	itemTheMenuCarries: string | RegExp,
) => {
	const row = trackRow(page, index);
	if (isMobile) await pressAndHold(page, row);
	else await row.click({ button: "right" });
	await expect(
		page.getByRole("menuitem", { name: itemTheMenuCarries }),
	).toBeVisible();
};
