import { cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { build } from "vite";

// Two builds: the browser fetches a service worker by URL rather than importing
// it, so the worker is bundled separately as one classic script at a stable
// path. `sw.js` beside `index.html` is also what puts its scope at the root of
// the demo rather than inside `assets/`.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "dist-demo");

// Null, as in a real build: the component's port is on the page's own host. The
// worker answers before a request reaches any host, so that still holds.
const define = { __PLAYER_HOST__: "null" };

await build({
	configFile: false,
	root: HERE,
	// Relative, so the demo works under a project path (`/jean/`) or at the root
	// of a domain without being rebuilt.
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

// The captured library and its sleeves, verbatim and unhashed: the worker asks
// for both by name, resolved against its own scope. `library.json` stays out of
// the worker bundle because the worker is revalidated on every visit.
await cp(resolve(HERE, "artwork"), resolve(OUT, "artwork"), {
	recursive: true,
});
await cp(resolve(HERE, "library.json"), resolve(OUT, "library.json"));

console.log(`demo built into ${OUT}`);
