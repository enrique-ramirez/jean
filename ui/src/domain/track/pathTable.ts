const BLOCK = 256;

const grownTo = (indices: Int32Array<ArrayBuffer>, length: number) => {
	if (length < indices.length) return indices;
	const grown = new Int32Array(indices.length * 2);
	grown.set(indices);
	return grown;
};

interface TextBlocks {
	add: (text: string) => number;
	read: (index: number) => string;
}

function textBlocks(): TextBlocks {
	const closed: string[] = [];
	let open: string[] = [];
	let openText: string | null = null;
	let ends = new Int32Array(BLOCK);
	let count = 0;

	return {
		add: (text) => {
			ends = grownTo(ends, count);
			ends[count] = (open.length === 0 ? 0 : ends[count - 1]) + text.length;
			open.push(text);
			openText = null;
			count += 1;

			if (open.length === BLOCK) {
				closed.push(open.join(""));
				open = [];
			}
			return count - 1;
		},

		read: (index) => {
			const start = index % BLOCK === 0 ? 0 : ends[index - 1];
			const block = closed[Math.floor(index / BLOCK)];
			if (block !== undefined) return block.slice(start, ends[index]);
			openText ??= open.join("");
			return openText.slice(start, ends[index]);
		},
	};
}

export interface PathTable {
	readonly length: number;
	at: (index: number) => string;
}

export interface PathCollector {
	add: (path: string) => void;
	// Later additions do not reach a view already handed out, so one published mid-load goes on
	// describing the rows it was published with.
	table: () => PathTable;
}

// The player reports library paths forward-slashed and its own paths with the platform separator, so
// the split takes whichever came last rather than a configured one.
export const afterLastSeparator = (path: string) =>
	Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;

export function pathCollector(): PathCollector {
	const directories = textBlocks();
	const remainders = textBlocks();
	let directoryOf = new Int32Array(BLOCK);
	let count = 0;

	let openDirectory = "";
	let openDirectoryIndex = -1;

	return {
		add: (path) => {
			const cut = afterLastSeparator(path);

			// Compared without slicing, so an ordinary row allocates nothing for its directory.
			if (
				openDirectoryIndex < 0 ||
				cut !== openDirectory.length ||
				!path.startsWith(openDirectory)
			) {
				openDirectory = path.slice(0, cut);
				openDirectoryIndex = directories.add(openDirectory);
			}

			directoryOf = grownTo(directoryOf, count);
			directoryOf[count] = openDirectoryIndex;
			remainders.add(path.slice(cut));
			count += 1;
		},

		table: () => {
			const length = count;
			return {
				length,
				at: (index) =>
					index >= 0 && index < length
						? directories.read(directoryOf[index]) + remainders.read(index)
						: "",
			};
		},
	};
}
