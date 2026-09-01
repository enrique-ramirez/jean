import { execFileSync } from "node:child_process";

// One build for the whole run, before any worker starts. Vite is fast enough
// here that caching it against a source hash would cost more than it saves.
export default function build() {
	execFileSync("pnpm", ["exec", "vite", "build"], { stdio: "inherit" });
}
