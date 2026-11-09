// .github/workflows/release.yml hands this script's output to `gh release`.
//
//   node scripts/release-notes.mjs v0.7.1

import { isReleaseSubject, parse, types } from "./lib/conventional.mjs";
import { git } from "./lib/git.mjs";

const [tag] = process.argv.slice(2);
if (!tag) {
	console.error("usage: release-notes.mjs <tag>");
	process.exit(1);
}

const slug =
	process.env.GITHUB_REPOSITORY ??
	git("remote", "get-url", "origin")
		.replace(/^.*github\.com[:/]/, "")
		.replace(/\.git$/, "");
const url = `https://github.com/${slug}`;

let previous;
try {
	previous = git(
		"describe",
		"--tags",
		"--abbrev=0",
		"--match",
		"v*",
		`${tag}^`,
	);
} catch {
	previous = null;
}

const commits = git(
	"log",
	"--no-merges",
	"--format=%H%x00%B%x1e",
	previous ? `${previous}..${tag}` : tag,
)
	.split("\x1e")
	.map((record) => record.trim())
	.filter(Boolean)
	.map((record) => {
		const [sha, message] = record.split("\x00");
		return { sha, message: message.trim(), parsed: parse(message.trim()) };
	})
	.filter(({ message }) => !isReleaseSubject(message));

const known = (parsed) => parsed !== null && Object.hasOwn(types, parsed.type);

const line = ({ sha, message, parsed }) => {
	const text = known(parsed)
		? `${parsed.scope ? `**${parsed.scope}**: ` : ""}${parsed.description}`
		: message.split("\n")[0];
	return `- ${text} ([${sha.slice(0, 7)}](${url}/commit/${sha}))`;
};

const section = (title, entries) =>
	entries.length === 0 ? [] : [`## ${title}`, "", ...entries.map(line), ""];

const breaking = commits.filter(({ parsed }) => parsed?.breaking);
const rest = commits.filter(({ parsed }) => !parsed?.breaking);
const output = [
	...section("Breaking changes", breaking),
	...Object.entries(types).flatMap(([type, title]) =>
		section(
			title,
			rest.filter(({ parsed }) => parsed?.type === type),
		),
	),
	...section(
		"Other",
		rest.filter(({ parsed }) => !known(parsed)),
	),
];
if (previous)
	output.push(`**Full changelog**: ${url}/compare/${previous}...${tag}`);

process.stdout.write(`${output.join("\n")}\n`);
