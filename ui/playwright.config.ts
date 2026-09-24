import { defineConfig, devices } from "@playwright/test";

// LIVE names the origin of a real player already serving Jean, and replaces the suite rather
// than adding to it: these specs drive one foobar2000 that cannot be reset between tests, so
// they run alone, in order, and against the build that is already deployed.
const LIVE = process.env.LIVE;

// Tests run against a production build served by the fake player, because that is the shape
// the component itself deploys: one origin serving both the app and /api. A dev server with a
// proxy in front of it would test an arrangement that only exists locally.
export default defineConfig({
	testDir: "./test/e2e",
	globalSetup: LIVE ? undefined : "./test/e2e/build.ts",

	// Generous rather than tight. A loaded machine pushes ordinary toBeVisible assertions past
	// the 5s default and reports them as failures. Raising the ceiling cannot make a failing
	// assertion pass; genuine hangs are still caught by the test timeout below.
	expect: { timeout: 15_000 },
	timeout: 60_000,

	fullyParallel: !LIVE,
	workers: LIVE ? 1 : undefined,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI
		? [["github"], ["html", { open: "never" }]]
		: [["list"]],

	use: {
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		// Reduced motion is accepted in `use` without complaint but never reaches a Chromium
		// context, so the fixtures call page.emulateMedia() instead. See test/e2e/fixtures.ts.
	},

	projects: LIVE
		? [
				{
					name: "live",
					testDir: "./test/live",
					use: {
						...devices["Desktop Chrome"],
						viewport: { width: 1280, height: 860 },
						baseURL: LIVE,
					},
				},
			]
		: [
				{
					name: "desktop",
					use: {
						...devices["Desktop Chrome"],
						viewport: { width: 1280, height: 860 },
					},
				},
				// Below the 860px JS breakpoint and the 720px CSS one, with touch on: the sidebar is a
				// drawer, menus are action sheets, and drag is unavailable. Different components rather
				// than narrower ones, so a desktop-only suite would not cover them.
				{
					name: "mobile",
					use: { ...devices["Pixel 7"] },
				},
			],
});
