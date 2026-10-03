# Review 01 — post-M5 critical review

Reviewed 2026-10-03 against the M5 build (`7fc2843`, v0.6.0) by the design
author. Audience: the implementing agent. Work the items in severity order;
they are independent, so stopping after any one of them leaves a working build.

**Credit where due, because it changes how to read the criticism below.** The
overnight run shipped all six milestones with honest acceptance, 93 green
tests, and — the hard part — it kept the ritual: `STATUS.md` was rewritten
every block and it refused to invent work after M5. The findings here are not
"the build is bad." They are "the build is correct and nearly unusable by
anyone who has not read `DESIGN.md`."

**The theme:** the plugin is engineered for the author and opaque to everyone
else. It silently modifies every session's context, offers no way to stop it,
no way to see what it sent, and explains none of its own vocabulary.

## Do not, while fixing these

- Do not add a settings system, a config file format, or a preferences UI.
- Do not make the line caps, the char ceiling, or the trigger phrases configurable.
- Do not add dependencies, a CSS pipeline, or a promote button.
- Do not touch the host invariants: the plugin still never writes `ME.md` or a
  project `MEMORY.md` except through an explicit human action in the pane.

---

## R1 · Lost update — pane silently clobbers hand edits (severity: high)

`MemoryBody.tsx` `EditSection` seeds its draft once
(`setDraft(current => current === null ? fileText : current)`) and never
adopts later values. `PUT /api/dsh-memento/file` (`src/host/index.ts`) is a
blind overwrite with no precondition. Together: edit `ME.md` in an editor while
the pane is open → the pane keeps the old text → `dirty` becomes true without
anyone typing → Save writes the stale draft over the new file.

This is the worst place in the product for this bug, because **hand-editing
`ME.md` is the primary write path by design** and the pane is secondary.

**Fix.** Adopt incoming `fileText` whenever the section is *not* dirty. When it
*is* dirty and the file changed underneath, show a conflict line
("changed on disk — reload / overwrite") rather than silently preferring either
side. Have `GET /state` return each file's `mtimeMs`, have the client echo it
in `PUT`, and have the host reply `409` when it no longer matches.

**Accept.** `agent/accept-m4.mjs` gains: (a) a non-dirty section adopts an
external change; (b) `PUT` with a stale `mtimeMs` returns 409 and the file on
disk is byte-unchanged; (c) `PUT` with a current `mtimeMs` succeeds.

## R2 · No on/off — the user cannot stop the plugin (severity: high)

There is **no** enable/disable anywhere in `src/`. The plugin always injects
into every session, always captures `Remember this:`, always tracks ritual
compliance. A user who dislikes any of that has to uninstall the package.
Silently altering every prompt with no off switch is not acceptable behaviour
for a plugin, and it is the first thing a new user will look for.

**Fix — one master switch, stored on disk, not in a settings system.**
Presence of the file `~/.dsh/memory/.off` means disabled. The pane header
carries the toggle; the human can equally `touch` or `rm` the file by hand.
That keeps "disk is law" intact and adds no config format.

Disabled must stop all three behaviours — inject, capture, compliance
tracking — and the pane must say so in plain words, not go blank. The files
stay readable and editable while off.

**Accept.** New `agent/accept-m6.mjs`: with `.off` present, (a) a session start
injects **nothing** (sentinel absent from the session log), (b) `POST /capture`
returns `{ok:true, captured:false, reason:"disabled"}` and `inbox.md` is
byte-unchanged, (c) no `.compliance.log` line is appended on session end,
(d) `GET /state` reports `enabled:false`, (e) removing `.off` restores all
three without a restart.

## R3 · No way to see what was injected (severity: high)

`state.inject` exposes `chars`, `budget`, and `truncated` — never the text.
The user cannot verify what the plugin said to the model on their behalf. This
is the trust surface, and its absence is the single biggest credibility gap:
every competing memory product asks you to trust an opaque step, and we are
currently doing the same thing.

**Fix.** M1 already computes and caches the block. Add `inject.text` to the
state payload and render it in the pane as a read-only, collapsed-by-default
block: *"Sent to the model at the start of this session"*. Verbatim bytes, no
reformatting.

**Accept.** `accept-m1.mjs` gains: `state.inject.text` is byte-identical to the
string found in the session log by the existing sentinel check.

## R4 · The pane explains nothing (severity: high — this is the usability bug)

Two `title` attributes exist in the entire client, both on the delete button.
A user who has not read `DESIGN.md` sees `ME.md 8 / 30`, `no project memory`,
`Inbox 3 total`, and `ritual: no sessions logged · this session: no ritual
required`, and cannot answer: *what is injected, when, why is there a limit,
what is the inbox for, how does something get out of it, what is a ritual?*

**Fix.** Add a one-line purpose under each section heading, a collapsible
"What is this?" at the top, and `title` tooltips on the counter, the cap
sentence, and the compliance strip. **Use this copy; do not invent your own**
— the wording is the design talking:

- **Top, collapsible.** "Memento gives new sessions a warm start. `ME.md` and
  the project file below are pasted into the beginning of every new chat, so
  the agent already knows them. Nothing else in this pane is sent
  automatically."
- **ME.md.** "Injected into every new session, everywhere. Keep it to things
  that stay true: who you are, how you work, hard constraints."
- **Counter tooltip.** "8 of 30 lines used. The limit is deliberate: a short
  file gets read, a long one gets skimmed. At the limit, add a line by
  removing one."
- **Project.** "Injected only when you work in `<path>`. Decisions, gotchas and
  conventions that are not obvious from the code."
- **Create.** "Creates the file. It stays empty until you write something."
- **Inbox.** "A scratch list — **nothing here is sent to the agent**. Saying
  'Remember this: …' in chat lands a line here. To make it stick, copy the line
  up into `ME.md` or the project file."
- **Compliance strip, plain language.** Replace "ritual / compliant /
  non-compliant" with: "Agent checked your project memory before editing
  files: 7 of 9 sessions." Current session: "not needed yet" / "yes" / "no —
  it edited first".

Keep "never record what `rg` can find / must still be true in three months /
if you had to say it twice" visible near `ME.md`. It is currently only inside
the file's own header, where it scrolls out of the 90px textarea immediately.

## R5 · Editors are too small to use (severity: medium)

`ME.md` gets `minHeight: 90` against a 30-line cap; the project file gets 120
against 45. The screenshot shows four of eight lines. The cap exists so the
whole file is comprehensible at a glance — an editor showing a sixth of it
defeats the mechanism.

**Fix.** Auto-size to content up to roughly cap height, keep `resize: vertical`.

## R6 · Inbox rows are unreadable (severity: medium)

Rows render the raw stored line, so each one leads with
`2026-10-03T13:26:43+02:00 [--home-hagbard-dev-dsh-memento--]` before any
content, at 11.5px in a narrow pane.

**Fix.** Keep the raw line as stored truth and as the `title` tooltip; display
relative time, a short project chip, and the text starting at the left edge.

## R7 · Smaller items (severity: low)

- **Compliance strip placement.** It occupies the most prominent position while
  usually saying nothing. Move it to the bottom and hide it entirely until
  `history.total > 0`.
- **Project key is opaque.** `--home-hagbard-dev-deepseek-harness--` should
  render as the real path, with the key in the tooltip. In the review
  screenshot the project section showed one project while every inbox line came
  from another; with no labels they read as contradictory.
- **Create writes `''`.** A zero-byte file that injects nothing. Seed it with a
  commented header, as `ME.template.md` does.
- **Dead binding.** `EditSection` destructures `snapshot` from `useMemory()`
  and never uses it.

## R8 · Process finding (severity: low, but instructive)

`plan/STATUS.md` is **50 lines against its own 45-line cap**. The file that
teaches cap pressure blew its cap, because nothing made the pressure visible —
exactly the failure the design predicts. Trim it as part of the next rewrite,
and treat it as evidence for R3/R4: invisible limits do not hold.
