import { defineConfig, devices } from "@playwright/test";

// Tests run against a production build served by the fake player, because that
// is the shape beefweb actually deploys: one origin serving both the app and
// /api. A dev server with a proxy in front of it would be testing an
// arrangement that only exists on this machine.
export default defineConfig({
	testDir: "./test/e2e",
	globalSetup: "./test/e2e/build.ts",

	// Generous rather than tight. A slow machine -- a laptop doing three other
	// things, CI on a shared runner -- pushed a handful of ordinary
	// toBeVisible assertions past the 5s default and reported them as failures,
	// which is the most expensive kind of wrong: nothing was broken, and the
	// suite said something was. Raising the ceiling cannot make a failing
	// assertion pass; it only stops a passing one from being cut off. Genuine
	// hangs are still caught by the test timeout below.
	expect: { timeout: 15_000 },
	timeout: 60_000,

	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI
		? [["github"], ["html", { open: "never" }]]
		: [["list"]],

	use: {
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		// Reduced motion is not set here. It belongs in `use` and is accepted
		// there without complaint, but as of 1.62 it never reaches a Chromium
		// context -- verified by reading matchMedia from inside a test. The
		// fixtures call page.emulateMedia() instead; see test/e2e/fixtures.js.
	},

	projects: [
		{
			name: "desktop",
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1280, height: 860 },
			},
		},
		// Below the 860px JS breakpoint and the 720px CSS one, with touch on: the
		// sidebar is a drawer, menus are action sheets, and drag is not available
		// at all. Different components, not a narrower version of the same ones --
		// so a desktop-only suite would not be testing them.
		{
			name: "mobile",
			use: { ...devices["Pixel 7"] },
		},
	],
});
