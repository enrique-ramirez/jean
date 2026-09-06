# Talking to the player

The beefweb client, the wire types, and the one discovery both optional-component seams are fed from. Knows nothing about Jean.

**[README.md](README.md) is the reference, and the traps live there rather than here.** Read its *Traps that cost time* section before writing anything that talks to beefweb, and its `foo_jean` half before touching discovery, pairing or the stream. [ARCHITECTURE.md](../../../ARCHITECTURE.md) has why discovery sits in this folder and what the two seams downstream of it guarantee.

**`discoverFooJean()` belongs here and not beside either consumer.** Tag writing is in `domain/track` and listening is in `domain/player`, tiers that may not import each other, and each running its own probe would send two status calls and two capabilities calls to answer one question. `FooJeanState` describes the *component*, not either seam.

**A failure that might clear is marked `retryable`, and `shared/hooks/useFooJean.ts` widens the interval between attempts while it stays that way.** A player not running yet is the ordinary case for a page left open, so caching the first "unreachable" for the life of the tab means the component never turns up without a reload — while polling a dead port at a fixed rate is the other failure. The widening happens inside the query function rather than inside `refetchInterval`, which react-query is free to consult more than once per cycle.

## Types

**`foo_jean`'s types are generated from the component's OpenAPI document**, which is the contract: `npx openapi-typescript ../foo_jean/docs/openapi.yaml`, committed, with no codegen step in `pnpm build` — that would make the build depend on a sibling repo being checked out.

**`types.ts` is hand-written and is the contract for beefweb.** Deliberately not generated: beefweb's own OpenAPI document describes 0.10, and the parts Jean leans on hardest — the media library API, and fields that are *absent* rather than empty — are either newer than it or not expressible in it. The fake player is checked against these same types, which is the point: a response shape drifting from what the app expects is the bug the suite exists to catch.
