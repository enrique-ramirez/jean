import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import type { Plugin } from "vite";

import { en } from "../src/shared/i18n/en.ts";

/**
 * `en.json` is generated rather than checked in: it is the file people copy to start a translation,
 * and a hand-maintained copy of `en.ts` would drift from it the first time a phrase changed. Keys
 * are sorted so a translator can diff one release against the next.
 */
const english = () =>
	`${JSON.stringify(Object.fromEntries(Object.entries(en).sort(([a], [b]) => (a < b ? -1 : 1))), null, "\t")}\n`;

/** Translations Jean ships with. Vite copies `public/` verbatim, so only the code list is needed here. */
export function shippedLocales(root: string): string[] {
	try {
		return readdirSync(resolve(root, "public/locales"))
			.filter((name) => name.endsWith(".json"))
			.map((name) => name.slice(0, -".json".length));
	} catch {
		return [];
	}
}

export function localePlugin(): Plugin {
	return {
		name: "jean-locales",

		configureServer(server) {
			server.middlewares.use("/locales/en.json", (_request, response) => {
				response.setHeader("Content-Type", "application/json");
				response.end(english());
			});
		},

		generateBundle() {
			this.emitFile({
				type: "asset",
				fileName: "locales/en.json",
				source: english(),
			});
		},
	};
}
