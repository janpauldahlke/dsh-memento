# Smoke protocol

**Smoke ≠ acceptance.** `agent/accept-m*.mjs` prove each milestone's contract in
isolation (93 tests). Smoke proves the *assembled thing* still works on this
machine and that the invariants nobody writes a unit test for still hold.

Run it: after any change you intend to keep, before handing the repo to an
overnight agent, and after any `dsh` version bump. **Budget: ~6 minutes.**
Any FAIL → stop, write the blocker in `STATUS.md`, do not continue to the next
section.

---

## 0 · Preflight (30 s)

```sh
cd ~/dev/dsh-memento
dsh --version                      # expect 0.1.7-rc.2 — drift from ENV.md is a finding, not a detail
ss -ltnp | grep -E ':3080|:8080'   # both up and NOT yours to touch
ss -ltn  | grep ':11434' && echo "FAIL: ollama is back up"
node build.mjs && ls -l lib/index.js lib/client.js   # both must exist and be fresh
```

## 1 · Scripted (90 s)

```sh
npm test                                            # unit: expect all green
. ./.env.local && ./agent/boot-3090.sh              # acceptance server
for m in 0 1 2 3 4 5; do node agent/accept-m$m.mjs || echo "FAIL m$m"; done
```

All six must exit 0. A milestone that regresses under a later build is the
single most common failure here — that is why they are re-run as a set, not
individually.

## 2 · Invariant tripwires (60 s)

These encode the rules that would be *catastrophic* to break silently. None of
them are covered by the acceptance scripts in a cross-cutting way.

```sh
sha256sum ~/.dsh/memory/ME.md                       # note it; must be unchanged by §3 except where stated
git ls-files | grep -E '\.env|ENV\.md' && echo "FAIL: secret tracked"
git log origin/main..HEAD --oneline 2>/dev/null | wc -l   # unpushed commits are expected; a push is not
grep -rn "openai\|anthropic\|fetch(.*api\." src/host/ | grep -v "^.*://127.0.0.1" && echo "FAIL: outbound LLM call"
ls ~/.dsh/sessions/*/*/session.lock >/dev/null && echo "sessions present (M5 corpus intact)"
```

Then confirm the plugin has not written the injected tier on its own: nothing
in §1 may have changed `ME.md`'s sha256.

## 3 · The human loop (3 min) — the part no script covers

**3.1 Cold-session warmth.** Append a sentinel fact to `ME.md` by hand (your
editor, not the pane): `- SMOKE-<random>: the operator's test word is quokka.`
Start a **new** session on `:3090` in any project and ask a question only that
line answers. Expect the answer. This is the product working or not.

**3.2 Sentinel-in-log (mechanical backstop for 3.1).** If the model answers
badly, the inject may still be fine — verify without the model:

```sh
zstd -dc $(ls -t ~/.dsh/sessions/*/*/session.v*.jsonl.zstd | head -1) | grep -c SMOKE-
```

Non-zero means the block reached the model and the failure is the model, not
the plugin. Zero means the inject broke.

**3.3 Disk↔pane round trip.** With the Memory pane **open**, edit `ME.md` in
your editor and save. The pane must show your new text within ~5 s. Then edit
in the pane and Save; your editor must show the pane's text on reload. A pane
that keeps showing stale content — or a Save that reverts your editor edit —
is a lost update, and it matters more here than anywhere else because
hand-editing the file is the *primary* write path by design.

**3.4 Capture + Undo.** Say `Remember this: smoke test <random>` in the session.
Expect one new inbox line in the pane. Delete it from the pane; expect the rest
of `inbox.md` byte-identical (`sha256sum` before/after, minus that line).

**3.5 Cap pressure.** Paste 31 lines into the pane's `ME.md`. Expect the counter
to turn warn/crit and the sentence *"at cap — adding a line means removing one"*.
Expect the save to be **accepted** — the cap is pressure, never enforcement.
Restore `ME.md` afterwards.

**3.6 Ritual strip.** End the session, start another, and check the compliance
strip moves off `0/0`. Until it does, M3 has never actually been measured.

## 4 · Teardown

Remove the §3.1 sentinel from `ME.md`. Confirm the sha256 from §2 is restored.
Leave `:3080` / `:8080` untouched. Kill only `dsh-memento-3090`, by pid.

---

## Triage

| Symptom | Most likely cause |
| --- | --- |
| accept-m0 fails after a `dsh` bump | version drift — see `ENV.md`, not your bug |
| Pane blank, `/state` 404 | client built but host half not loaded — check `main` in `package.json` |
| Pane stale after external edit | the draft-seeding path in `MemoryBody.tsx` (§3.3) |
| `0/0` compliance forever | no session has *ended* under an M3+ build |
| M5 returns `degraded[]` entries | expected and fine — it is fail-open by contract |
