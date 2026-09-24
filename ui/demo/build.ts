import { cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { build } from "vite";

import { localePlugin, shippedLocales } from "../scripts/localePlugin.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const define = {
	__SHIPPED_LOCALES__: JSON.stringify(shippedLocales(ROOT)),
};

export async function buildDemo(out = resolve(ROOT, "dist-demo")) {
	await build({
		configFile: false,
		root: HERE,
		base: "./",
		publicDir: resolve(ROOT, "public"),
		define,
		plugins: [react(), localePlugin()],
		resolve: { alias: { "@": resolve(ROOT, "src") } },
		build: { outDir: out, emptyOutDir: true },
	});

	await build({
		configFile: false,
		root: ROOT,
		base: "./",
		define,
		build: {
			outDir: out,
			emptyOutDir: false,
			lib: {
				entry: resolve(HERE, "sw.ts"),
				formats: ["iife"],
				name: "sw",
				fileName: () => "sw.js",
			},
		},
	});

	await cp(resolve(HERE, "artwork"), resolve(out, "artwork"), {
		recursive: true,
	});
	await cp(resolve(HERE, "library.json"), resolve(out, "library.json"));

	console.log(`demo built into ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildDemo();
