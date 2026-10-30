export interface ArtistTracks {
	own: Int32Array;
	shared: Int32Array;
	guest: Int32Array;
	// All three, in library order. The split is how the overview *draws* them; it is not three sets, and
	// playing the artist from any surface has to mean the same thing.
	all: Int32Array;
}
