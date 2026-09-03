import { execFileSync } from "node:child_process";

// One build for the whole run, before any worker starts.
export default function build() {
	execFileSync("pnpm", ["exec", "vite", "build"], { stdio: "inherit" });
}
