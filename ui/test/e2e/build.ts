import { execFileSync } from "node:child_process";

import { distDir } from "./dist.ts";

export default function build() {
	execFileSync(
		"pnpm",
		["exec", "vite", "build", "--outDir", distDir(), "--emptyOutDir"],
		{ stdio: "inherit" },
	);
}
