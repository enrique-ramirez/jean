# The contract

`openapi.yaml` is the HTTP contract between Jean and whatever writes tags, keeps autoplaylists and streams audio for it. `foo_jean` is the implementation that exists; nothing in the contract is about foobar2000, and nothing here assumes it.

This package is the two things that hang off that file: a conformance suite any implementation can be driven with, and the step that regenerates Jean's TypeScript client from it.

## What reads it

Four things, each of which spells the path out for itself, so a move breaks all four at once:

- `spec.ts`, which inlines every `$ref` and hands the operations to both suites.
- `pnpm types:api`, which regenerates `ui/src/shared/api/fooJeanSchema.d.ts`.
- `plugins/fb2k/tests/support/repository.cpp`, which `spec.cpp` asks for the repository root: it takes `__FILE__` and strips the literal suffix in `kSelf`.
- `plugins/fb2k/scripts/test.sh` and `test.ps1`, which climb to the repository root and check the spec's `version:` against `kVersion` in `plugins/fb2k/src/core/version.h` before either builds anything.

## Running the suite

```sh
CONTRACT_URL=http://<player-host>:8881/api pnpm test:contract
```

`CONTRACT_URL` is the base url the spec's `servers` block describes, including the `/api` prefix. It is not required: `test/conformance.test.ts` skips rather than fails without it, so a run with no player in reach costs nothing.

What one run does to the player, which is little but not nothing:

- **It writes no tags.** The address it sends carries the run's own identifier, so it names a track no library holds and a conformant implementation refuses it. This is the one probe that changes a file on disk if its address resolves, and the spec's example address is library-relative, so a library holding a track at that path would resolve it.
- **It creates one autoplaylist and deletes it again.** The title and the key carry an identifier generated for the run, so neither can collide with a playlist somebody else made. A run that dies between the two leaves the playlist behind, named so it is obvious what it was.
- **It declares a column set of its own through the rows route and reads no row.** One column, and where the library is not built to it the component rebuilds to that one-column set, so a client using the install declares its own again. The request carries the spec's example `structure`, which no library sits on, so the answer is a `409` or a `202`.
- **It asks for one cover and expects not to get it.** The address it sends names a track no player holds, because the suite reads no row of the library and holds no library-relative path, so what the answer pins is the refusal rather than a picture.
- **It empties the play queue.** `DELETE /queue` carries no revision to refuse it against, so nothing scopes the clear to what the run added; point `CONTRACT_URL` at an install whose queue is nobody's to lose. The move and remove probes beside it name a revision no queue holds, so those two change nothing.
- **It opens the stream and hangs up at once**, mints a ticket, and asks for the output hold to be released.
- **It creates one private session** and plays the library's first track in it with nobody listening, so nothing decodes and nothing is heard. That play names the run's session and never the player's own. It reads the session, lists the sessions, stops sharing it, and leaves it last, which ends it at once; that leave names the session, so the run's linger on the player's own stream runs out on its own. Where the implementation declines to create one, the leave ends that linger instead.

## What it checks

One request per operation the spec publishes, in an order that lets a playlist be created before it is repointed and deleted, and a ticket be minted before the stream it opens. `test/conformance.test.ts` is what each answer is held to, and `shape.ts` with `test/spec.test.ts` beside it is what checking a document against a schema means.

Two decisions behind those assertions are worth stating, because neither is readable from them.

**A `503` is how an implementation says it cannot do a thing at all.** The contract already publishes that status for tag writing, for autoplaylists and for streaming, so a host that genuinely cannot do one of them answers `503` in the published shape, passes, and is reported as declining it. Everything else fails: an unpublished status, a document with the wrong keys or an error string the contract does not publish, no answer. That is the whole of the difference between not implemented and implemented wrongly, and it is the contract's own vocabulary rather than a convention invented here.

**Request bodies come from the spec's own examples wherever it offers one.** That is why the query an autoplaylist is created with is the player's language and not a dialect written into this suite: the contract says the player owns that language, so the suite has to take it from the contract.

## Claiming conformance

An implementation conforms when this suite is green against it: every operation under `paths:` is routed, only the statuses that operation's `responses:` lists come back, every document carries exactly the keys its schema declares, and a field the schema enumerates or fixes carries one of the values it publishes. An error string the contract does not publish fails on its own, with every key around it right, and so does a refusal claiming the write it refused.

**Add an operation to the spec in the same change that implements it.** `test/spec.test.ts` fails when the spec publishes something the suite does not drive, so a new route has to be driven before it can be shipped.

## The generated client

`ui/src/shared/api/fooJeanSchema.d.ts` is `openapi-typescript` output from that spec:

```sh
pnpm types:api
```

Nothing in the ordinary build runs it, which is how it can go stale without anybody noticing, so `.github/workflows/contract.yml` runs it and fails when the result differs from what is committed. Regenerate in the same change as any spec edit.

**The generator is fetched by `pnpm dlx` at the pinned version rather than installed.** `openapi-typescript` builds its output through the compiler's node factory, and the native TypeScript 7 this repository runs does not expose `ts.factory` at all, so an installed copy would drag a second TypeScript into the workspace to load against.
