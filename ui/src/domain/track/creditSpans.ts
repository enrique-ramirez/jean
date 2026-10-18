import type { Member } from "@/domain/artist/credits";
import {
	collapseRepeatedTag,
	isCreditSeparator,
	namesAnArtist,
	splitCredit,
} from "./fields";

export interface CreditSpan {
	text: string;
	name: string | null;
}

const isNameCharacter = (character: string | undefined) =>
	character !== undefined && /[\p{L}\p{N}]/u.test(character);

const plain = (text: string): CreditSpan => ({ text, name: null });

function memberSpans(credit: string, members: readonly Member[]): CreditSpan[] {
	const names = [...new Set(members.map((member) => member.name))]
		.filter(namesAnArtist)
		.sort((a, b) => b.length - a.length)
		.map((name) => ({ name, lower: name.toLowerCase() }));

	const spans: CreditSpan[] = [];
	let text = "";
	let at = 0;

	while (at < credit.length) {
		const hit = isNameCharacter(credit[at - 1])
			? undefined
			: names.find(
					({ lower }) =>
						credit.slice(at, at + lower.length).toLowerCase() === lower &&
						!isNameCharacter(credit[at + lower.length]),
				);

		if (!hit) {
			text += credit[at];
			at += 1;
			continue;
		}

		if (text) spans.push(plain(text));
		text = "";
		spans.push({
			text: credit.slice(at, at + hit.name.length),
			name: hit.name,
		});
		at += hit.name.length;
	}

	if (text) spans.push(plain(text));
	return spans;
}

const featuredSpans = (credit: string): CreditSpan[] =>
	splitCredit(credit).map((part, at) =>
		isCreditSeparator(at) || !namesAnArtist(part)
			? plain(part)
			: { text: part, name: collapseRepeatedTag(part.trim()) },
	);

export function creditSpans(
	credit: string,
	members: readonly Member[],
): CreditSpan[] {
	const named = memberSpans(credit, members);
	return named.some((span) => span.name !== null)
		? named
		: featuredSpans(credit);
}
