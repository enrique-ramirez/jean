// The demo's library, named album by album.
//
// `test/fake-api/capture.ts --albums demo/albums.ts --out demo` pulls these off a
// real foobar2000 and writes `demo/library.json` plus a cover each.
//
// Separate from the fixture under `test/fake-api/`, which is five albums chosen
// for the branches the UI has and which every spec is written against. This list
// is chosen to be recognised, and changing it cannot break a test.
//
// The first block is widely recognised records. The rest fill gaps the app has a
// feature for:
//
//   discs        a two- or three-disc set restarts %tracknumber% mid-album
//   codecs       FLAC, AAC and a mixed-format album, for the Details panel
//   plays        albums played to death, and albums never opened at all --
//                the home shelves are a picture of that distribution
//   lyrics       albums whose files carry `unsynced lyrics`, for that tab
//   ratings      a few rated albums, so the column is not uniformly empty
//   language     Spanish, French and Japanese tags, and accents to fold
//   era          1965 to 2022, because a decade filter of one decade is a list

export interface DemoAlbum {
	albumArtist: string;
	album: string;
	// Capture the lyric text for this album, not just the length probe. Off by
	// default and per album, because a lyric is licensed text: six albums is
	// enough to show the tab, the scroll-in-time and tapping a line to seek.
	// `Vessel` carries some plain and some timed lyrics, so both code paths are on
	// screen.
	lyrics?: true;
}

// Spelled exactly as the player reports `%album artist%` and `%album%`,
// punctuation and accents included. A title the capture cannot match is an album
// silently dropped.
export const ALBUMS: DemoAlbum[] = [
	// ---- widely recognised -------------------------------------------------
	{ albumArtist: "Metallica", album: "Metallica" },
	{ albumArtist: "Nirvana", album: "Nevermind", lyrics: true },
	{ albumArtist: "Oasis", album: "(What's the Story) Morning Glory?" },
	{ albumArtist: "Justin Bieber", album: "Purpose" },
	{ albumArtist: "The Beatles", album: "The Beatles" },
	{ albumArtist: "Bad Bunny", album: "Un verano sin ti", lyrics: true },
	{ albumArtist: "Lorde", album: "Pure Heroine" },
	{ albumArtist: "Mac Miller", album: "Watching Movies With the Sound Off" },
	{ albumArtist: "The Strokes", album: "Is this it" },
	{ albumArtist: "Muse", album: "Black Holes & Revelations" },
	{ albumArtist: "Radiohead", album: "OK Computer", lyrics: true },
	{ albumArtist: "Limp Bizkit", album: "Significant Other" },
	{ albumArtist: "Gorillaz", album: "Gorillaz", lyrics: true },
	{ albumArtist: "Tool", album: "Lateralus" },
	{
		albumArtist: "The Smashing Pumpkins",
		album: "Mellon Collie and the Infinite Sadness",
	},
	{ albumArtist: "Maroon 5", album: "It Won't Be Soon Before Long" },
	{ albumArtist: "Daft Punk", album: "Discovery" },
	{ albumArtist: "Queen", album: "A Night At The Opera" },
	{ albumArtist: "Pink Floyd", album: "Dark Side Of The Moon" },
	{ albumArtist: "Porcupine Tree", album: "In Absentia" },
	{ albumArtist: "Twenty One Pilots", album: "Vessel", lyrics: true },
	{
		albumArtist: "Brand New",
		album: "The Devil and God Are Raging Inside Me",
	},
	{ albumArtist: "Brand New", album: "Science Fiction" },
	{ albumArtist: "Mumford & Sons", album: "Sigh No More" },
	{ albumArtist: "Skrillex", album: "Bangarang" },
	{ albumArtist: "The Smiths", album: "Louder Than Bombs" },
	{ albumArtist: "Stevie Wonder", album: "In Square Circle" },
	{ albumArtist: "Tame Impala", album: "Innerspeaker" },
	{ albumArtist: "Tiësto", album: "In Search of Sunrise 4: Latin America" },
	{ albumArtist: "Tom Odell", album: "Long Way Down" },
	{ albumArtist: "Mooncake", album: "Lagrange Points" },
	{ albumArtist: "The xx", album: "xx" },
	{ albumArtist: "White Lies", album: "Ritual" },
	{ albumArtist: "Coldplay", album: "Ghost Stories" },
	{ albumArtist: "Childish Gambino", album: "STN MTN / Kauai" },
	{ albumArtist: "The Cardigans", album: "Acoustic" },
	{ albumArtist: "Korn", album: "MTV Unplugged" },
	{ albumArtist: "Nirvana", album: "MTV Unplugged in New York" },

	// ---- more from the same artists ----------------------------------------
	// One album per artist would make every artist page a single row and the
	// "more by" shelf meaningless.
	{ albumArtist: "The Beatles", album: "Abbey Road" },
	{
		albumArtist: "The Beatles",
		album: "Sgt. Pepper's Lonely Hearts Club Band",
	},
	{ albumArtist: "The Beatles", album: "Revolver" },
	{ albumArtist: "The Beatles", album: "Rubber Soul" },
	{ albumArtist: "The Beatles", album: "Let It Be" },
	{ albumArtist: "Queen", album: "News Of The World" },
	{ albumArtist: "Queen", album: "Jazz" },
	{ albumArtist: "Queen", album: "The Game" },
	{ albumArtist: "Queen", album: "A Kind of Magic" },
	// Two discs, live, and the loudest thing in the library's play counts.
	{ albumArtist: "Queen", album: "Live At Wembley '86" },
	{ albumArtist: "Pink Floyd", album: "The Wall" },
	{ albumArtist: "Pink Floyd", album: "The Final Cut" },
	{ albumArtist: "Radiohead", album: "The Bends" },
	{ albumArtist: "Radiohead", album: "Kid A" },
	{ albumArtist: "Radiohead", album: "In Rainbows" },
	{ albumArtist: "Nirvana", album: "In Utero" },
	{ albumArtist: "Nirvana", album: "Bleach" },
	{ albumArtist: "Metallica", album: "S&M" },
	{ albumArtist: "Metallica", album: "Load" },
	{ albumArtist: "Oasis", album: "The Masterplan" },
	{ albumArtist: "Oasis", album: "Be Here Now" },
	{ albumArtist: "Muse", album: "Absolution" },
	{ albumArtist: "Muse", album: "Origin of Symmetry" },
	{ albumArtist: "Gorillaz", album: "Demon Days" },
	{ albumArtist: "Gorillaz", album: "Plastic Beach" },
	{ albumArtist: "Tool", album: "Ænima" },
	{ albumArtist: "Daft Punk", album: "Homework" },
	{ albumArtist: "Daft Punk", album: "Random Access Memories" },
	// One album, half AAC and half FLAC. The Details panel reads the file rather
	// than the album, and this is the only way to see that.
	{ albumArtist: "Daft Punk", album: "TRON: Legacy" },
	{ albumArtist: "The Strokes", album: "Room On Fire" },
	{ albumArtist: "The Strokes", album: "First Impressions Of Earth" },
	{ albumArtist: "Coldplay", album: "A Rush of Blood to the Head" },
	{ albumArtist: "Coldplay", album: "Parachutes" },
	{ albumArtist: "Maroon 5", album: "Songs About Jane" },
	{ albumArtist: "Mac Miller", album: "Blue Slide Park" },
	{ albumArtist: "Korn", album: "Follow The Leader" },
	{ albumArtist: "Korn", album: "Issues" },
	{ albumArtist: "The Smashing Pumpkins", album: "Adore" },
	{ albumArtist: "Stevie Wonder", album: "Innervisions" },
	{ albumArtist: "Stevie Wonder", album: "Talking Book" },
	{ albumArtist: "The Smiths", album: "The Queen Is Dead" },
	// Never played once: the home screen has a shelf for unopened records and
	// needs some.
	{ albumArtist: "The Smiths", album: "Strangeways, Here We Come" },
	{ albumArtist: "The Cardigans", album: "Life" },
	{ albumArtist: "The Cardigans", album: "First Band on the Moon" },
	{ albumArtist: "The xx", album: "Coexist" },
	{ albumArtist: "White Lies", album: "To Lose My Life..." },
	{ albumArtist: "Twenty One Pilots", album: "Blurryface" },
	{ albumArtist: "Twenty One Pilots", album: "Twenty One Pilots" },
	{ albumArtist: "Brand New", album: "Deja Entendu", lyrics: true },
	{ albumArtist: "Brand New", album: "Your Favourite Weapon" },
	{ albumArtist: "Mumford & Sons", album: "Babel" },
	{ albumArtist: "Porcupine Tree", album: "Deadwing" },
	{ albumArtist: "Childish Gambino", album: "Camp" },
	{ albumArtist: "Bad Bunny", album: "YHLQMDLG" },
	{ albumArtist: "Bad Bunny", album: "X 100PRE" },
	{ albumArtist: "Tiësto", album: "Just Be" },
	{ albumArtist: "Limp Bizkit", album: "Three Dollar Bill, Yall$" },

	// ---- filling the gaps --------------------------------------------------
	{ albumArtist: "Green Day", album: "Dookie" },
	{ albumArtist: "Green Day", album: "American Idiot" },
	{ albumArtist: "Linkin Park", album: "Hybrid Theory" },
	{ albumArtist: "Linkin Park", album: "Meteora" },
	{ albumArtist: "Placebo", album: "Sleeping With Ghosts" },
	{ albumArtist: "Placebo", album: "Meds" },
	{ albumArtist: "Blur", album: "Parklife" },
	{ albumArtist: "Pulp", album: "Different Class" },
	{ albumArtist: "Pearl Jam", album: "Yield" },
	{ albumArtist: "Pearl Jam", album: "Lost Dogs" },
	{ albumArtist: "Eminem", album: "The Slim Shady LP" },
	{ albumArtist: "The Cure", album: "Kiss Me Kiss Me Kiss Me" },
	{ albumArtist: "Adele", album: "21" },
	{ albumArtist: "Hozier", album: "Hozier" },
	{ albumArtist: "The Weeknd", album: "Beauty Behind the Madness" },
	{ albumArtist: "Post Malone", album: "beerbongs & bentleys" },
	// AAC and MP3 in one album, the way a collection ripped over fifteen years is.
	{ albumArtist: "Bruno Mars", album: "Doo-Wops & Hooligans" },
	{ albumArtist: "Usher", album: "Confessions" },
	{ albumArtist: "Death Cab for Cutie", album: "Plans" },
	{ albumArtist: "Kings of Convenience", album: "Riot on an Empty Street" },
	{ albumArtist: "The Front Bottoms", album: "Talon of the Hawk" },
	{
		albumArtist: "Explosions in the Sky",
		album: "Friday Night Lights: Original Motion Picture Soundtrack",
	},
	{ albumArtist: "God Is An Astronaut", album: "God Is An Astronaut" },
	{ albumArtist: "Mogwai", album: "Mr. Beast" },
	{ albumArtist: "Have a Nice Life", album: "Deathconsciousness" },
	{ albumArtist: "Alice in Chains", album: "Jar Of Flies" },
	{ albumArtist: "As Tall as Lions", album: "Lafcadio" },
	// `fold()` exists for this: a search for `babasonicos` has to find it.
	{ albumArtist: "Babasónicos", album: "Jessico" },
	{ albumArtist: "Babasónicos", album: "Infame" },
	{ albumArtist: "Babasónicos", album: "Luces" },
	{ albumArtist: "La Renga", album: "Trueno y Tierra" },
	{ albumArtist: "Los Planetas", album: "La leyenda del espacio" },
	{ albumArtist: "Pastora", album: "Pastora" },
	{ albumArtist: "Luis Miguel", album: "Aries" },
	{ albumArtist: "Ozuna", album: "Odisea" },
	{ albumArtist: "Sonata Arctica", album: "The Days of Grays" },
	{ albumArtist: "Opeth", album: "Damnation" },
	{ albumArtist: "Ayreon", album: "The Human Equation" },
	// Three discs. Nothing else in the library has that shape.
	{ albumArtist: "Blind Guardian", album: "Live" },
	{ albumArtist: "4 Non Blondes", album: "Bigger, Better, Faster, More!" },
	{ albumArtist: "Justice", album: "Audio, Video, Disco." },
	{ albumArtist: "David Guetta", album: "One Love" },
	{ albumArtist: "Swedish House Mafia", album: "Until One" },
	{ albumArtist: "Coleman Hawkins", album: "Body and Soul" },
	{ albumArtist: "Paris Combo", album: "Paris Combo" },
	{ albumArtist: "Hiromi Uehara", album: "Place to Be" },
	{ albumArtist: "The Cinematic Orchestra", album: "Ma fleur" },
	{ albumArtist: "Tom Waits", album: "Closing Time" },
	{ albumArtist: "Son House", album: "Father of Folk Blues" },
	{
		albumArtist: "Big Brother & The Holding Company",
		album: "Cheap Thrills",
	},
	{ albumArtist: "Laura Marling", album: "I Speak Because I Can" },
	{ albumArtist: "Rodrigo y Gabriela", album: "Area 52" },
	{ albumArtist: "Rata Blanca", album: "Magos, espadas y rosas" },
	{ albumArtist: "Carbon Based Lifeforms", album: "World of Sleepers" },
	// The most-played record in the library, and 67 tracks of it: one album longer
	// than most playlists.
	{
		albumArtist: "Yasunori Mitsuda, Various Artists",
		album: "Chrono Cross Original Soundtrack",
	},
	{ albumArtist: "Koichi Sugiyama", album: "Dragon Quest VI on Piano" },
	{
		albumArtist: "Gareth Coker",
		album: "Ori and the Blind Forest (Additional Soundtrack)",
	},
];
