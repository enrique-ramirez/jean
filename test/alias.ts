// Two things about `src/` that node's resolver does not know: `@/` is Vite's
// alias for `src/`, and imports inside `src/` are written without an extension.
// The e2e specs never meet either -- they drive the built app over HTTP -- but a
// unit test importing a module from `src/` meets both, so `pnpm test:unit` loads
// this first. Registered here rather than worked around by rewriting imports:
// the alias is a contribution rule, enforced by Biome per tier.

import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");

const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

registerHooks({
	resolve(specifier, context, next) {
		const aliased = specifier.startsWith("@/")
			? pathToFileURL(join(SRC, specifier.slice(2))).href
			: specifier;

		const relative = aliased.startsWith(".") || aliased.startsWith("file:");
		if (!relative || HAS_EXTENSION.test(aliased)) return next(aliased, context);

		// A component is `.tsx`; everything else in `src/` is `.ts`.
		try {
			return next(`${aliased}.ts`, context);
		} catch {
			return next(`${aliased}.tsx`, context);
		}
	},
});
