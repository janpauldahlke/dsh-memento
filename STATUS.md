# dsh-memento

- **Long horizon:** ON
- **Phase:** M1 vault + inject
- **cwd:** `/home/hagbard/dev/dsh-memento`
- **Updated:** 0s ago

## Now

- **In flight:** M1 acceptance re-run after fixes: check 4 uses 3 read-tool steps (host has no usable sandbox backend — AppArmor blocks bwrap userns, headless has no approval channel), httpJson retries transient fetch failures, standaloneEnv strips only the 3 session vars. On green → commit M1 + rewrite plan/STATUS.md.
- **Next 3:**
  1. M1 — vault + inject. plan/M1-vault-inject.md: ME.md from template, cache-stable inject, sentinel proven in session log.
  2. M2 — inbox write. plan/M2-inbox-write.md: Remember: → append inbox.md + Undo, no classification.
  3. M3 — ritual enforcement. plan/M3-ritual-enforcement.md: verify the ritual happened (sentinel/guardrail).

## Done (recent)

- ✓ M0 — dual-face skeleton committed (7d6dd36): plugin installed in web profile, :3090 health route exact, acceptance green ×2 · verify: node agent/accept-m0.mjs exit 0 (×2); dsh --profile web --dump-config shows memento row; curl :3090/api/dsh-memento/health = {ok:true,plugin:dsh-memento,version:0.1.0,milestone:M0}; client module present in boot combo bundle · 3h ago

*Last write branch:* `main`
