import { cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { build } from "vite";

// Two builds, because a service worker is not a module the page imports -- the
// browser fetches it by URL and runs it on its own. So the app is bundled the
// way `vite build` bundles it, and the worker is bundled separately, as one
// classic script at a stable path: `sw.js` beside `index.html`, which is also
// what puts its scope at the root of the demo rather than inside `assets/`.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "dist-demo");

// Null, as in a real build: there the page is served by the player, so the
// component's port is on the page's own host. Here nothing is on any host --
// the worker answers before the request reaches one -- and the page's host is
// still the right answer.
const define = { __PLAYER_HOST__: "null" };

await build({
	configFile: false,
	root: HERE,
	// Relative, so the demo works under a project path (`/jean/`) or at the root
	// of a domain without being rebuilt for either.
	base: "./",
	publicDir: resolve(ROOT, "public"),
	define,
	plugins: [react()],
	resolve: { alias: { "@": resolve(ROOT, "src") } },
	build: { outDir: OUT, emptyOutDir: true },
});

await build({
	configFile: false,
	root: ROOT,
	base: "./",
	define,
	build: {
		outDir: OUT,
		// The app build just wrote everything else into it.
		emptyOutDir: false,
		lib: {
			entry: resolve(HERE, "sw.ts"),
			formats: ["iife"],
			name: "sw",
			fileName: () => "sw.js",
		},
	},
});

// The five captured sleeves, verbatim and unhashed: the worker asks for them by
// the name the fake's own state answers with, resolved against its scope. The
// other two hundred covers are drawn rather than fetched -- see `cover.ts`.
await cp(resolve(ROOT, "test/fake-api/artwork"), resolve(OUT, "artwork"), {
	recursive: true,
});

console.log(`demo built into ${OUT}`);
