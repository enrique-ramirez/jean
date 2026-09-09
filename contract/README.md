# The contract

`plugins/fb2k/docs/openapi.yaml` is the HTTP contract between Jean and whatever writes tags, keeps autoplaylists and streams audio for it. `foo_jean` is the implementation that exists; nothing in the contract is about foobar2000, and nothing here assumes it.

This package is the two things that hang off that file: a conformance suite any implementation can be driven with, and the step that regenerates Jean's TypeScript client from it.

## Where the spec lives, and why not here

It stays at `plugins/fb2k/docs/openapi.yaml`. Two things read it there at run time. `plugins/fb2k/tests/support/spec.cpp` opens it by taking `__FILE__` and stripping a literal path suffix, and `plugins/fb2k/scripts/test.sh` checks its `version:` against `kVersion` in `plugins/fb2k/src/core/version.h`. Both break silently if the file moves, and neither is something a grep for the filename would turn up. The plugin tree is also what gets copied to a Windows build machine, so a spec kept anywhere else would stop travelling with the build it describes.

## Running the suite

```sh
CONTRACT_URL=http://<player-host>:8881/api CONTRACT_TOKEN=<token> pnpm test:contract
```

`CONTRACT_URL` is the base url the spec's `servers` block describes, including the `/api` prefix. With no `CONTRACT_URL` the suite skips rather than fails, so it costs nothing in a run with no player in reach. With no `CONTRACT_TOKEN` only `getStatus` and `pair` run. The contract names a third credential-free route, `openStream`, but it still waits on a ticket only an authenticated call can mint, so it skips too without a token.

What one run does to the player, which is little but not nothing:

- **It writes no tags.** The write it sends carries the spec's own example, which names a track that does not exist, so a conformant implementation refuses it.
- **It creates one autoplaylist and deletes it again.** The title and the key carry a token generated for the run, so neither can collide with a playlist somebody else made. A run that dies between the two leaves the playlist behind, named so it is obvious what it was.
- **It opens the stream and hangs up at once**, mints a ticket, asks for the output hold to be released, and leaves.
- **It calls the pairing route, last.** With no pairing window open that is a refusal. With one open it spends the grant, closing the window, so open one at the player only when that is what you want tested, and only once the rest of the run has nothing left to drive.

## What it checks

One request per operation the spec publishes, in an order that lets a playlist be created before it is repointed and deleted, and a ticket be minted before the stream it opens. For each answer:

1. The implementation answered at all.
2. The status is one the spec publishes for that operation.
3. The document carries every key the schema declares as required, no key it does not declare, and no value of a type it does not publish.

A response the spec declares no JSON body for, meaning `204` and the audio stream itself, is checked for its status alone.

**A `503` is how an implementation says it cannot do a thing at all.** The contract already publishes that status for tag writing, for autoplaylists and for streaming, so a host that genuinely cannot do one of them answers `503` in the published shape, passes, and is reported as declining it. Everything else fails: an unpublished status, a document with the wrong keys, no answer. That is the whole of the difference between not implemented and implemented wrongly, and it is the contract's own vocabulary rather than a convention invented here.

Request bodies come from the spec's own examples wherever it offers one. That is why the query an autoplaylist is created with is the player's language and not a dialect written into this suite: the contract says the player owns that language, so the suite has to take it from the contract.

## Claiming conformance

An implementation conforms when this suite is green against it with a token set. In practice:

- Route every operation under `paths:`. One this host cannot do answers `503` with the error document the spec publishes for it, never a `404` and never silence.
- Answer only statuses that operation's `responses:` lists.
- Carry exactly the keys each schema declares, including in nested objects and array items.
- Add an operation to the spec in the same change that implements it. `contract/test/spec.test.ts` fails when the spec publishes something the suite does not drive, so a new route has to be driven before it can be shipped.

## The generated client

`ui/src/shared/api/fooJeanSchema.d.ts` is `openapi-typescript` output from that spec:

```sh
pnpm types:api
```

Nothing in the ordinary build runs it, which is how it can go stale without anybody noticing, so `.github/workflows/contract.yml` runs it and fails when the result differs from what is committed. Regenerate in the same change as any spec edit.

The generator lives in this package rather than beside the file it writes because it needs a TypeScript 5. It builds its output through the compiler's node factory, and the native TypeScript 7 that the rest of the repository runs does not expose `ts.factory` at all, so the generator throws as it loads.
