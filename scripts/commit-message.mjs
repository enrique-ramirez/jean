import { readFileSync } from "node:fs";
import {
	isReleaseSubject,
	problems,
	releaseSubject,
} from "./lib/conventional.mjs";
import { git } from "./lib/git.mjs";

const lines = (text) => (text === "" ? [] : text.split("\n"));

const report = (label, found) => {
	for (const problem of found) console.error(`${label}: ${problem}`);
	return found.length === 0;
};

const checkFile = (path) => {
	const message = readFileSync(path, "utf8")
		.replace(/\r/g, "")
		.split("\n")
		.filter((line) => !line.startsWith("#"))
		.join("\n")
		.trim();
	return report(
		"commit message",
		problems(message, lines(git("diff", "--cached", "--name-only"))),
	);
};

const checkCommits = (shas) =>
	shas
		.map((sha) => {
			const message = git("log", "-1", "--format=%B", sha).trim();
			const files = lines(
				git("diff-tree", "--no-commit-id", "-r", "--name-only", sha),
			);
			return report(
				`${sha.slice(0, 7)} ${message.split("\n")[0]}`,
				problems(message, files),
			);
		})
		.every(Boolean);

const checkRange = (range) =>
	checkCommits(lines(git("rev-list", "--reverse", "--no-merges", range)));

// A push's `before` is all zeros for a new branch, and a clone no longer holds it after a force
// push: both fall back to HEAD alone.
const ciRange = () => {
	const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
	const head = process.env.GITHUB_SHA;
	if (process.env.GITHUB_EVENT_NAME === "pull_request")
		return `${event.pull_request.base.sha}..${event.pull_request.head.sha}`;
	const before = event.before ?? "";
	if (process.env.GITHUB_EVENT_NAME !== "push" || /^0+$/.test(before))
		return `${head}^!`;
	try {
		git("cat-file", "-e", `${before}^{commit}`);
		return `${before}..${head}`;
	} catch {
		return `${head}^!`;
	}
};

const [mode, argument] = process.argv.slice(2);
let ok;
switch (mode) {
	case "--file":
		ok = checkFile(argument);
		break;
	case "--range":
		ok = checkRange(argument);
		break;
	case "--ci":
		ok = checkRange(ciRange());
		break;
	case "--is-release":
		ok = isReleaseSubject(argument ?? "");
		break;
	case "--release-subject":
		process.stdout.write(`${releaseSubject(argument)}\n`);
		ok = true;
		break;
	default:
		console.error(
			"usage: commit-message.mjs --file <path> | --range <a..b> | --ci | --is-release <subject> | --release-subject <version>",
		);
		ok = false;
}
process.exit(ok ? 0 : 1);
