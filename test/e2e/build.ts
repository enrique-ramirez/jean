import { execFileSync } from "node:child_process";

export default function build() {
	execFileSync("pnpm", ["exec", "vite", "build"], { stdio: "inherit" });
}
