import { cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { build } from "vite";

import { localePlugin, shippedLocales } from "../scripts/localePlugin.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "dist-demo");

// Null, as in a real build: the component's port is on the page's own host. The
// worker answers before a request reaches any host, so that still holds.
const define = {
	__PLAYER_HOST__: "null",
	__SHIPPED_LOCALES__: JSON.stringify(shippedLocales(ROOT)),
};

await build({
	configFile: false,
	root: HERE,
	base: "./",
	publicDir: resolve(ROOT, "public"),
	define,
	plugins: [react(), localePlugin()],
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
		emptyOutDir: false,
		lib: {
			entry: resolve(HERE, "sw.ts"),
			formats: ["iife"],
			name: "sw",
			fileName: () => "sw.js",
		},
	},
});

await cp(resolve(HERE, "artwork"), resolve(OUT, "artwork"), {
	recursive: true,
});
await cp(resolve(HERE, "library.json"), resolve(OUT, "library.json"));

console.log(`demo built into ${OUT}`);
