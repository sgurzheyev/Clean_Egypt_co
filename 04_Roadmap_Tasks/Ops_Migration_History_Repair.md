---
title: Ops — Migration History Repair
type: ops
status: canonical
updated: 2026-09-17
tags: [garbagin, supabase, migrations, ops, cli, wave-e, wave-h]
aliases: [Migration history repair, supabase migration repair, Local-only timestamps]
---

# Ops — repair CLI migration history (do not `db push`)

> How to mark the `20260912_*` and `20260917_*` lifecycle files as **applied** after they were pasted in the SQL Editor.  
> Wave E hub: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] · F/G/H: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] · apply order: [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] · migrations MOC: [[03_Backend_SQL/SQL_Migrations_Index]] · vault: [[🗺️ GARBAGIN Master Index]]

This note changes **history tracking only**. It does not re-run SQL and must not reset the hosted project.

Live Garbagin already has P0→D and F/G/H + Hungry-Games objects (verify / markers in [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]). The CLI may still show those filenames as **Local** because `supabase_migrations.schema_migrations` was never inserted. Same pattern for **`20260917_*`** even though `platform_admins` (etc.) already exists on hosted.

---

## Why the list is wrong

`supabase db push` / `migration list` compare **leading digit prefixes** (the “timestamp”) in `supabase/migrations/*.sql` against `supabase_migrations.schema_migrations`.

P0–D were applied by **pasting** these files (or `psql`), not by `db push`:

| File | CLI version (leading digits) | Wave |
| --- | --- | --- |
| [[../supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]] | `20260912` | P0 |
| [[../supabase/migrations/20260912_overfund_refund_and_creator_convert.sql]] | `20260912` | A |
| [[../supabase/migrations/20260912_wave_b_failed_recovery_abandon_confirm.sql]] | `20260912` | B |
| [[../supabase/migrations/20260912_wave_c_amount_target_profile_delete.sql]] | `20260912` | C |
| [[../supabase/migrations/20260912_wave_d_garbage_history_window.sql]] | `20260912` | D |
| [[../supabase/migrations/20260917_wave_f_security_hardening.sql]] | `20260917` | F |
| [[../supabase/migrations/20260917_wave_g_lifecycle_hardening.sql]] | `20260917` | G |
| [[../supabase/migrations/20260917_wave_h_surface_hardening.sql]] | `20260917` | H |
| [[../supabase/migrations/20260917_hungry_games_subscription_gate.sql]] | `20260917` | Hungry-Games |

The five `20260912_*` files share prefix **`20260912`**. The four `20260917_*` files share **`20260917`**. The CLI treats each prefix as **one** version. `migration list` typically shows a **Local** row and an empty **Remote** cell — that is the “Local-only timestamps” symptom, not missing SQL.

**Do not `db push` `20260917_*`.** Filename sort puts `hungry_games_subscription_gate` **before** `wave_f_security_hardening`. Hungry-Games calls `is_platform_admin` from Wave F — paste order is in [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]], not `ls`.

Older same-day files (`20260722_*`, `20260723_*`, …) already use this date-only convention. Do **not** rename the `20260912_*` or `20260917_*` files after live apply — that would invent new Local versions and make the list worse.

---

## Never do this on hosted

| Command / action | Why |
| --- | --- |
| `supabase db push` while Local-only `20260912` or `20260917` remains | May try to replay SQL, collide with existing functions/policies, or apply unrelated pending files |
| `supabase db reset` / `supabase db pull` “to sync” on remote | Destructive or overwrites history; remote is the source of truth for *schema*, not for unrecorded filenames |
| `supabase migration repair --status reverted 20260912` (or `20260917`) | Drops the history row. A later `db push` will try to run the SQL again |
| `supabase migration repair --local …` when you meant hosted | `--local` is the Docker DB only. Hosted repair is the default (`--linked`) |
| Adding another `20260912_*.sql` or `20260917_*.sql` | Same version string → CLI will skip it as already applied after repair |

`migration repair` updates **`supabase_migrations.schema_migrations` only**. It does not apply or revert SQL. That is why it is the right tool here — after you have independently proven the objects exist.

---

## Diagnose

From a machine that is `supabase link`’d to the **hosted** project (not a throwaway local):

```bash
supabase migration list
```

Expect something like:

```
LOCAL      | REMOTE     | TIME (UTC)
-----------|------------|----------------
20260912   |            | 2026-09-12 …
```

Confirm schema **without** push — paste the matching verify file from [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] in the SQL Editor. If verify is green, the missing Remote cell is history-only.

Optional read (SQL Editor, no writes):

```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version LIKE '20260912%' OR version LIKE '20260917%'
ORDER BY version;
```

Empty result + green verify = this runbook. Rows already present = skip repair.

---

## Repair (hosted history table)

Default target is the **linked remote**. Do not pass `--local`.

```bash
# 1) Prove SQL is already there (SQL Editor) — see docs/LIFECYCLE_FIX_APPLY_RUNBOOK.md
# 2) Mark each shared date prefix applied. One version covers all 20260912_* files; one covers all 20260917_*.
supabase migration repair --status applied 20260912
supabase migration repair --status applied 20260917

# 3) Confirm Remote now matches Local for those versions
supabase migration list
```

CLI equivalent flags if you are not using the default link:

```bash
supabase migration repair --linked --status applied 20260912
# or
supabase migration repair --db-url "$DATABASE_URL" --status applied 20260912
```

`--status applied` **inserts** version `20260912`. It does not execute the five SQL files.

After this, a later `db push` of a **new** unique-timestamp file can run. Still do not `db push` as a way to “install” P0–D — those files stay history-only.

### If repair refuses / version already exists

- Row present → stop. History is already repaired.
- Auth / link errors → use the SQL Editor insert below. Do not `db push` to “force” it.

---

## SQL Editor fallback (same effect as repair)

Use only when the CLI cannot reach the linked project. This is still **history only**:

```sql
INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('20260912'), ('20260917')
ON CONFLICT (version) DO NOTHING;

-- Some CLI versions also store a name. If the insert fails on NOT NULL name:
-- INSERT INTO supabase_migrations.schema_migrations (version, name)
-- VALUES ('20260912', 'lifecycle_p0_through_wave_d')
-- ON CONFLICT (version) DO NOTHING;

SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version IN ('20260912', '20260917');
```

If the table has extra columns in your project, inspect `\d supabase_migrations.schema_migrations` (or the Table Editor) and insert the minimum required fields. Do not invent extra versions for the five filenames.

---

## Future migrations (avoid a repeat)

1. New files: **`YYYYMMDDHHMMSS_snake_name.sql`** (14-digit clock, unique). Example: `20260912154500_optional_zero_hide_r2_purge.sql`.
2. Apply new files with `db push` **only after** `migration list` shows no unexpected Local-only rows.
3. If you must paste in the SQL Editor again, immediately `migration repair --status applied <that-unique-timestamp>`.
4. Do not add another `20260912_*.sql` or `20260917_*.sql`.

Wave E/H docs do **not** rename the existing files. Rename-after-apply would create new Local versions and require extra repairs for no product gain.

---

## Related

- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]]
- [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]]
- [[03_Backend_SQL/SQL_Migrations_Index]]
- [[01_Architecture/Security_and_RPCs]]
- [Supabase: migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair)
- [Supabase: diagnose push vs history](https://supabase.com/docs/guides/deployment/database-migrations)
