import { execFileSync } from "node:child_process";

export const git = (...args) =>
	execFileSync("git", args, { encoding: "utf8" }).trimEnd();
