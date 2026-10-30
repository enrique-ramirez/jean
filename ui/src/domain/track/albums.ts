export interface AlbumTracks {
	refs: Int32Array;
	// As the files spell them. The route carries the halves normalised, and a page may not draw those.
	album: string;
	artist: string | null;
}
