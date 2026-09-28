# Contributing

How to write code in this repository. [ui/CONTRIBUTING.md](./ui/CONTRIBUTING.md) adds what is specific to the web UI, and [plugins/fb2k/CONTRIBUTING.md](./plugins/fb2k/CONTRIBUTING.md) what is specific to `foo_jean`. To *use* Jean, read the [README](./README.md).

## 1. Where things live

`ui/` is Jean, the web app. `site/` is the landing page, its own package under `ui/`'s rules, built by `pnpm site` and published to Pages with the demo underneath it. `contract/` is the API specification every plugin implements and the conformance suite that measures one. `plugins/fb2k/` is `foo_jean`, the foobar2000 component, in C++.

## 2. Design

The standard is one thing: control complexity so a person can read the result. Craftsmanship and simplicity agree on nearly all of what follows: names carry the meaning, a unit does one thing, duplication is a defect, clarity beats cleverness. Where they pull apart is how much structure is worth its cost, and that is settled below in favour of the simpler reading.

1. **Structure is never free, and must earn its place.** SOLID describes forces, not a checklist. An interface, a factory or a layer is justified by a second caller that exists, not by one that might. "Open for extension" is not a licence to design for a change nobody has asked for; the cheapest way to be open to a change is to be small enough to alter.
2. **Extract until the name stops paying.** Pull a block out when its name tells the reader more than the code did. Stop when following one idea means jumping between fragments that only make sense together. A shredded function is harder to read than the loop it replaced, and readability is the whole point.
3. **One reason to change.** A unit that both decides and acts has two. Keep the decision pure and testable, and put the mechanism where it belongs.
4. **Names are the primary documentation.** If a name needs a comment, the name is wrong. Reach for a better name before reaching for a sentence.
5. **The second copy is the bug.** Two statements of one fact drift, silently. Name it once and let both callers reach it.
6. **Do one thing well, and compose.** Prefer a small piece with a plain interface over a subsystem with options. Prefer passing a value in to reaching out for one. It is what makes a thing testable, and it is dependency inversion at the only scale that reliably pays.
7. **Be pragmatic before dogmatic.** No pattern is owed an appearance. If a rule here would make a file harder to read, the rule is wrong for that file; say so in the change rather than obeying it quietly.
8. **Each project has one architectural boundary, and it is enough.** Keep its direction exact, with no container, service locator or mediator to soften it.

## 3. Comments

Write a comment when the code is correct **because of something outside this repository**, and name that thing: what foobar2000, `foo_jean`, a browser or a library actually does. Every other claim a reader can check by reading; that one they cannot.

Everything else that seems to want a sentence is a name you have not found yet, or a function you have not extracted.

1. **Why a value was chosen is a named constant.** A duration, a threshold, a breakpoint, a timeout. A name says it at every use rather than once above one of them.
2. **What the code does is the code.** If following it needs prose, the prose is a bug report against the structure. Fix the structure.
3. **An external fact sits beside the one line it constrains.** One that governs several files is written once, in that project's `ARCHITECTURE.md`.
4. **Specs carry more.** A spec's name states the behaviour; a comment may state why the case exists at all and what breaks without it. That is documentation and it earns its place. Narrating the assertions is not.
5. **A lint suppression is code, not a comment, and carries its reason.**

**The test, before you write one.** Strip the comment and hand the code to somebody competent who has not seen it:

| they get it right | verdict |
|---|---|
| from the code | it was never needed |
| only because they happen to know foobar2000, or how Safari handles it | the fact is real: write the comment, naming the system |
| they cannot get it at all | write the comment |

`.claude/agents/comment-reaper.md` runs that test with an agent that has not seen the file.

## 4. Documentation

Documentation states the current design and nothing else. No history: what something used to be, why it changed, or what was rejected belongs in git rather than in a file. A sentence that exists to stop somebody undoing a decision is a test instead, or it goes; `.claude/doctrine/documentation.md` is the whole rule. No personal detail either: no names, machines, hostnames, addresses or real library paths, in prose, comments or test data. Use placeholders. Public repository URLs are fine.

**No measurements.** A measured number ties Jean to one library on one machine and then ships to everyone. Record the constraint a measurement established, such as "under *Playback follows cursor* foobar2000 advances through the focused playlist, not the playing one" or "there is no way to ask for a thumbnail", and never the measurement itself.

Never hard-wrap prose. One paragraph is one line, however long; editors wrap.

Each file has one job. A `README.md` is what its thing is and how to use it, a `CONTRIBUTING.md` how to write its code, an `ARCHITECTURE.md` how its parts fit. `ui/src/shared/api/README.md` is the player's surface. A `CLAUDE.md` is what an agent cannot read off the code, and stays short. Anything that is really a contribution rule belongs in a `CONTRIBUTING.md` and is linked from there, never copied.

`.claude/hooks/check-style.sh` fails an edit that reintroduces personal detail, history, hard-wrapped prose, a recorded measurement, an em dash, or one of the mechanical phrases in `.claude/voice/register.txt`. It fires on the edit tools and on a shell command that wrote a file, so a heredoc does not walk past it. It only catches what a grep can be certain of; the rest is your judgement.

Two reviewers cover that rest, over uncommitted changes and in this order: `style-reviewer` for design, structure, naming and duplication, then `comment-reaper` for comments and the prose of documentation. Run both before asking for a commit. Comment density is the rule that slips first, and it slips a little at a time.

`.claude/review-profile.md` is what tells both agents about this repository, and it carries a block per project: *Everywhere* applies to any diff, then one for `ui/` and one for `plugins/fb2k/`. The agents, the hooks and the voice files come from the `ai-engineering` kit, installed once at the root and the same in every project; the profile is the only part that is Jean's.

`pnpm sync-kit` takes the kit's current version of those files. It reports anything under `.claude/` that was edited here rather than in the kit, and moves it to `<name>.local.bak` rather than dropping it. A rule worth keeping belongs in the kit, so every project gets it; `.claude/register.local.txt` is the place for something that is genuinely only true of Jean.

## 5. Writing

Short sentences. RFC 2119 keywords for obligations. Commit messages take an imperative subject; add a body only for a fact the diff cannot show.

**Write like a person, not like an assistant.** Code is the source of truth; prose exists to say what the code cannot. The register that makes documentation unreadable is a house of throat-clearing, elevated synonyms and hedges. `.claude/voice/register.txt` holds the words to avoid and the hook checks a subset of them.

The words are the easy half. What actually gives an assistant away is shape: an em dash at every joint, a bolded pronouncement opening every paragraph, and sentences that never vary in length. `.claude/voice/constructions.md` is that list, and it is the one worth reading twice.

Plain words over elevated ones. No selling to a reader who is already here. No sentence whose only job is to introduce the next one.
