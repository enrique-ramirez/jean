/**
 * Typed or pasted text into chip values. A `;` or a line break ends a chip,
 * `\;` is a literal `;`, any other `\` stays as typed, and a comma never
 * splits since names such as "Crosby, Stills, Nash" hold them.
 */
export function chipsFrom(text: string, held: readonly string[]): string[] {
	const seen = new Set(held);
	const chips: string[] = [];
	let part = "";

	const finish = () => {
		const chip = part.trim();
		part = "";
		if (chip === "" || seen.has(chip)) return;
		seen.add(chip);
		chips.push(chip);
	};

	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === "\\" && text[i + 1] === ";") {
			part += ";";
			i++;
		} else if (c === ";" || c === "\n") {
			finish();
		} else {
			part += c;
		}
	}
	finish();
	return chips;
}

export function textOf(chip: string): string {
	return chip.replaceAll(";", "\\;");
}

export const endsChip = (text: string): boolean => /(?<!\\);/.test(text);
