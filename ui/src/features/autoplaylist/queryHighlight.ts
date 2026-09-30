import { KEYWORDS } from "@/domain/library/queryCompletion";

export interface Piece {
	text: string;
	isKeyword: boolean;
}

const TERM = new RegExp(
	`"(?:[^"]|"")*"?|\\b(?:${[...KEYWORDS].join("|")})\\b`,
	"gi",
);

export function piecesOf(query: string): Piece[] {
	const pieces: Piece[] = [];
	let from = 0;
	for (const match of query.matchAll(TERM)) {
		if (match[0].startsWith('"')) continue;
		if (match.index > from)
			pieces.push({ text: query.slice(from, match.index), isKeyword: false });
		pieces.push({ text: match[0], isKeyword: true });
		from = match.index + match[0].length;
	}
	if (from < query.length)
		pieces.push({ text: query.slice(from), isKeyword: false });
	return pieces;
}
