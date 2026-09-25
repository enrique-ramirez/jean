# Talking to the player

The `foo_jean` client, the wire types, and the one discovery both optional-component seams are fed from. Knows nothing about Jean.

**[README.md](README.md) is the reference, and the traps live there rather than here.** Read it before writing anything that talks to `foo_jean`, and its *Capability detection* section before reading a field the player may not resolve. [ARCHITECTURE.md](../../../ARCHITECTURE.md) has why discovery sits in this folder and what the two seams downstream of it guarantee.

**`discoverFooJean()` belongs here and not beside either consumer.** Tag writing is in `domain/track` and listening is in `domain/player`, tiers that may not import each other, and each running its own probe would send two capabilities calls to answer one question. `FooJeanState` describes the *component*, not either seam.

**A failure that might clear is marked `retryable`, and `shared/hooks/useFooJean.ts` widens the interval between attempts while it stays that way.** A player not running yet is the ordinary case for a page left open, so caching the first "unreachable" for the life of the tab means the component never turns up without a reload, while polling a dead port at a fixed rate is the other failure. The widening happens inside the query function rather than inside `refetchInterval`, which react-query is free to consult more than once per cycle.

**The library decoder takes views, never copies, and holds no string.** `jlib.ts` reads the snapshot's id arrays and dictionaries in place, which is what the format's four-byte alignment exists for, and decodes a value out of its text block each time something asks for it. Decoding a whole block up front, or keeping what has been decoded, puts a second copy of every column on the heap beside the bytes it came from, and that copy costs more than the format saves. **A caller sweeping a whole library MUST read the dictionary rather than the rows**, which is what `byValue` and `tagGroups` in `domain/track` are for.

**A delta is the exception, and it is decoded eagerly.** It carries what one revision added and nothing the client already holds, so its dictionary entries are a handful of strings; reading them up front is what lets a patched column keep a flat dictionary rather than a closure per patch. `patchColumn` is the only thing that writes an id array, and the column it returns owns one.

## Types

**`foo_jean`'s types are generated from `contract/openapi.yaml`**, which is the contract: `pnpm types:api` writes `fooJeanSchema.d.ts` and it is committed, with no codegen step in `pnpm build`. `contract/README.md` is how the committed copy is kept honest.

**`types.ts` is hand-written, and is the shape the rest of the app reads the player through**: the playing track, a playlist, a track's address, once what the component answered has been mapped into them. The fake player is checked against the generated types and these same ones, which is the point: a response shape drifting from what the app expects is the bug the suite exists to catch.
