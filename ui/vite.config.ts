import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { localePlugin, shippedLocales } from "./scripts/localePlugin.ts";

const FIRST_SCREEN_FONTS = [
	"montserrat-latin.woff2",
	"rethink-sans-latin.woff2",
];

function preloadFirstScreenFonts(): Plugin {
	let base = "";

	return {
		name: "jean:preload-first-screen-fonts",
		configResolved(config) {
			base = config.base;
		},
		transformIndexHtml: {
			order: "post",
			handler: (_html, { bundle }) => {
				if (!bundle) return [];
				const fonts = Object.values(bundle).filter(
					(file) =>
						file.type === "asset" &&
						file.names.some((name) => FIRST_SCREEN_FONTS.includes(name)),
				);
				if (fonts.length !== FIRST_SCREEN_FONTS.length)
					throw new Error(
						`preloadFirstScreenFonts found ${fonts.length} of ${FIRST_SCREEN_FONTS.join(", ")}`,
					);
				return fonts.map((file) => ({
					tag: "link",
					attrs: {
						rel: "preload",
						as: "font",
						type: "font/woff2",
						href: `${base}${file.fileName}`,
						// A browser fetches a font without credentials, so a preload that does not say the
						// same is a second request for the one file.
						crossorigin: true,
					},
					injectTo: "head",
				}));
			},
		},
	};
}

// A build needs no target at all: `foo_jean` serves Jean and answers `/api` from the one origin.
// Only the dev server, which serves Jean itself, has to be told where the player is.
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const target =
		process.env.FOO_JEAN_URL || env.FOO_JEAN_URL || "http://localhost:8881";

	return {
		define: {
			__SHIPPED_LOCALES__: JSON.stringify(shippedLocales(process.cwd())),
		},

		plugins: [react(), localePlugin(), preloadFirstScreenFonts()],

		resolve: { tsconfigPaths: true },

		base: "./",

		server: {
			port: 8123,
			// Predictable, so a phone typing this address or a bookmark does not go looking
			// for whichever port happened to be free.
			strictPort: true,
			// Bind on the LAN too, so a phone can load the dev server directly.
			host: true,
			proxy: {
				// Same-origin during development: no CORS, and SSE streams through untouched.
				"/api": { target, changeOrigin: true },
			},
		},
	};
});
