import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HELD =
	/^(height|width|(min|max)-(height|width)|grid-template-.*|padding(-.*)?|margin(-.*)?|inset(-.*)?|top|right|bottom|left|box-shadow|border-radius|background-position)$/;

// The action menu measures its page and writes the viewport's height; a transform cannot clip a
// container, so the slide between pages keeps this one.
const ALLOWED = [
	{
		file: "shared/ui/ActionMenu.module.css",
		selector: ".viewport",
		property: "height",
	},
	// A grid column cannot move by transform, and the sidebar's slide is kept for a toggle that
	// is rare.
	{
		file: "app/App.module.css",
		selector: ".body",
		property: "grid-template-columns",
	},
];

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");

const stylesheets = readdirSync(SRC, { recursive: true, encoding: "utf8" })
	.filter((file) => file.endsWith(".css"))
	.map((file) => ({
		file,
		text: readFileSync(join(SRC, file), "utf8").replace(
			/\/\*[\s\S]*?\*\//g,
			"",
		),
	}));

const TOP_LEVEL_COMMA = /,(?![^(]*\))/;

interface Transition {
	file: string;
	selector: string;
	property: string;
}

const transitions = stylesheets.flatMap(({ file, text }) =>
	[...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector, body]) =>
		[...body.matchAll(/transition(?:-property)?:\s*([^;]+);/g)].flatMap(
			([, value]) =>
				value
					.split(TOP_LEVEL_COMMA)
					.map((part) => part.trim().split(/\s+/)[0])
					.filter(Boolean)
					.map((property) => ({
						file,
						selector: selector.trim(),
						property,
					})),
		),
	),
);

const keyframeProperties = stylesheets.flatMap(({ file, text }) =>
	[...text.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)].flatMap((match) => {
		let depth = 1;
		let at = match.index + match[0].length;
		const from = at;
		while (depth > 0 && at < text.length) {
			if (text[at] === "{") depth += 1;
			if (text[at] === "}") depth -= 1;
			at += 1;
		}
		return [...text.slice(from, at).matchAll(/([a-z-]+)\s*:/g)].map(
			([, property]) => ({ file, name: match[1], property }),
		);
	}),
);

const isSame = (a: Transition, b: Transition) =>
	a.file === b.file && a.selector === b.selector && a.property === b.property;

const isAllowed = (transition: Transition) =>
	ALLOWED.some((allowed) => isSame(allowed, transition));

test("no transition moves a layout property or a shadow", () => {
	const offenders = transitions
		.filter(({ property }) => HELD.test(property))
		.filter((transition) => !isAllowed(transition))
		.map(({ file, selector, property }) => `${file} ${selector} ${property}`);
	assert.deepEqual(offenders, []);
});

test("no keyframe moves a layout property or a shadow", () => {
	const offenders = keyframeProperties
		.filter(({ property }) => HELD.test(property))
		.map(
			({ file, name, property }) => `${file} @keyframes ${name} ${property}`,
		);
	assert.deepEqual(offenders, []);
});

test("every allowed exception still names a transition in the tree", () => {
	for (const allowed of ALLOWED)
		assert.ok(
			transitions.some((transition) => isSame(allowed, transition)),
			`${allowed.file} ${allowed.selector} ${allowed.property}`,
		);
});
