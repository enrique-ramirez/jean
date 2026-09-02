// Covers for the synthesised half of the library.
//
// The alternative was to repeat the five captured sleeves across two hundred
// records, and a wall of the same five covers reads as broken rather than as
// synthetic. These are drawn instead: flat duotone geometry, deterministic from
// the album's name, so a record keeps its sleeve across reloads and no two
// records share one by accident.
//
// **Reference pass**: looked at generative sleeve work (Warp/Ghostly reissue
// covers, Brian Eno's generative series, the Nicholas Rougeux poster studies)
// and at what the album grid actually needs at 160px -- one legible shape and
// two colours. Rejected: anything with type on it, which at that size is a
// placeholder rather than a sleeve; and per-cover noise or blur, which costs
// more than it returns at thumbnail size and is the first thing that makes a
// generated set look generated.

// Eight pairs rather than a hue wheel: a hue picked at random lands on the
// muddy part of it about a third of the time, and a demo cannot afford a third
// of its records looking ill.
const PALETTE: [string, string, string][] = [
	["#12212e", "#1f6f7a", "#e9d8a6"],
	["#221726", "#6d3b6b", "#e7bfa5"],
	["#101a17", "#2f6b4f", "#dfe6c8"],
	["#241a13", "#8a4b2a", "#f0cba3"],
	["#181a2c", "#3f4b96", "#c9d6f0"],
	["#2b1418", "#a33a45", "#f2d0c2"],
	["#141d20", "#3f7d8c", "#f3e6d0"],
	["#1d1b12", "#7a6a2b", "#e8e2c4"],
];

const hashOf = (text: string) => {
	let hash = 0x81_1c_9d_c5;
	for (let at = 0; at < text.length; at += 1) {
		hash ^= text.charCodeAt(at);
		hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
	}
	return hash;
};

// Four compositions, because two is a pattern anyone sees on one screen and
// eight is a style nobody can hold.
const COMPOSITIONS = 4;

export function coverSvg(album: string): string {
	const hash = hashOf(album);
	// The saturated tone is the *ground*, not the mark. Drawn the other way round
	// -- a dark ground with a coloured figure on it -- two hundred sleeves read as
	// two hundred dark squares at the 32px a row draws them at, which is where
	// most of them are seen.
	const [ink, back, mid] = PALETTE[hash % PALETTE.length];
	const composition = (hash >> 3) % COMPOSITIONS;
	const drift = ((hash >> 7) % 60) - 30;
	const scale = 0.72 + ((hash >> 11) % 40) / 100;

	const marks =
		composition === 0
			? // Concentric arcs, struck off-centre.
				[220, 168, 116, 64]
					.map(
						(radius, ring) =>
							`<circle cx="${300 + drift}" cy="${300 - drift / 2}" r="${
								radius * scale
							}" fill="none" stroke="${ring % 2 ? ink : mid}" stroke-width="${
								26 - ring * 4
							}" />`,
					)
					.join("")
			: composition === 1
				? // A band across the diagonal, with the sun going down behind it.
					`<circle cx="${300 + drift}" cy="250" r="${140 * scale}" fill="${mid}" />` +
					`<rect x="-60" y="${330 + drift}" width="720" height="${
						72 * scale
					}" fill="${ink}" transform="rotate(${-12 + drift / 4} 300 300)" />`
				: composition === 2
					? // Bars, read as a spectrum rather than as a chart.
						Array.from({ length: 7 }, (_, bar) => {
							const height = 90 + ((hash >> (bar * 3)) % 300) * scale;
							return `<rect x="${64 + bar * 68}" y="${
								520 - height
							}" width="44" height="${height}" fill="${
								bar % 3 === 1 ? ink : mid
							}" />`;
						}).join("")
					: // A single form, cut.
						`<circle cx="300" cy="300" r="${190 * scale}" fill="${mid}" />` +
						`<rect x="${300 + drift}" y="40" width="520" height="520" fill="${back}" />` +
						`<circle cx="300" cy="300" r="${190 * scale}" fill="none" stroke="${ink}" stroke-width="8" />`;

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600"><rect width="600" height="600" fill="${back}" />${marks}</svg>`;
}
