// The media library's own address for a row. `%path%` is left out of `TRACK_EXPRESSIONS` because it
// is the largest field, and holding a full copy of every one here would give that saving straight
// back: the library source needs an address for artwork, identity and queueing, not a string per row.
//
// So a path is kept as the directory it sits in plus what is left, and directories are shared. Two
// facts about strings decide how:
//
//   - Slicing a string keeps the whole original alive, so a table of remainders sliced out of the
//     responses would hold every response string and save nothing. Joining a run of them into one
//     string is what lets the originals go.
//   - A string is held one byte per character only if every character in it fits, so one accented
//     filename doubles whatever it is joined to. The remainders are joined in blocks to bound that.

// Remainders per joined block: what one accented name costs, and what is re-joined on a read while
// the last block is still open.
const BLOCK = 256;

const grownTo = (indices: Int32Array<ArrayBuffer>, length: number) => {
	if (length < indices.length) return indices;
	const grown = new Int32Array(indices.length * 2);
	grown.set(indices);
	return grown;
};

// An append-only list of strings held as joined blocks, addressed by the order they arrived in.
interface TextBlocks {
	add: (text: string) => number;
	read: (index: number) => string;
}

function textBlocks(): TextBlocks {
	const closed: string[] = [];
	let open: string[] = [];
	let openText: string | null = null;
	// Where each piece ends inside its own block.
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

// A fixed-length reading of the paths interned so far. `at` answers the path back byte for byte.
export interface PathTable {
	readonly length: number;
	at: (index: number) => string;
}

export interface PathCollector {
	add: (path: string) => void;
	// A view over everything added so far. Later additions do not reach it, so a view published
	// mid-load goes on describing the rows it was published with.
	table: () => PathTable;
}

// The player reports library paths forward-slashed and its own paths with the platform separator, so
// the split takes whichever came last rather than a configured one.
const afterLastSeparator = (path: string) =>
	Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;

export function pathCollector(): PathCollector {
	const directories = textBlocks();
	const remainders = textBlocks();
	let directoryOf = new Int32Array(BLOCK);
	let count = 0;

	// Runs rather than a dictionary: the library is read in path order, so one directory's tracks
	// arrive together. Out of that order the table holds a directory more than once, which costs
	// memory and never an answer.
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
