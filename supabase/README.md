# Database setup

Every file here is a one-shot SQL script meant to be pasted into the
Supabase SQL Editor and run once, in the order below. There is no
migration runner and nothing records what you have already applied, so
keep track yourself — especially on a database that already has data.

`schema.sql` creates the base tables; everything after it was added as
the app grew, so the order is not alphabetical. A few files genuinely
depend on earlier ones (noted below); the rest are independent but are
listed in the order they were written, which is the combination that has
actually been run in production.

## Order

| # | File | What it does |
|---|------|--------------|
| 1 | `schema.sql` | Base tables (`organizations`, `org_members`, `servers`) with their RLS policies, plus the `uuid-ossp` extension. |
| 2 | `add-user-profiles.sql` | `user_profiles`, which holds the master-password verifier. |
| 3 | `fix-member-email.sql` | Replaces `handle_new_organization` so the owner's member row gets an email from the JWT instead of an empty string. |
| 4 | `fix-rls.sql` | Drops every policy on the base tables and recreates them from scratch. |
| 5 | `add-server-comment.sql` | `servers.comment`. |
| 6 | `add-user-settings.sql` | Nickname and default organization on `user_profiles`. Needs 2. |
| 7 | `add-snippets.sql` | `snippets`, the per-user encrypted command store. |
| 8 | `add-server-pinning.sql` | `servers.is_pinned` and `servers.sort_order`. |
| 9 | `security-hardening.sql` | Locks down the organization functions and `user_profiles` policies. Needs 2. |
| 10 | `add-account-deletion.sql` | `account_deletion_preview()` and `delete_my_account()` RPCs, including organization ownership transfer. |
| 11 | `harden-functions.sql` | Pins `search_path` on every function that existed at this point, closing the Database Advisor warnings. |
| 12 | `add-server-folders.sql` | `server_folders`, `servers.folder_id`, and the triggers that keep a folder and its servers in the same vault. Needs 8, because pins are scoped per folder. |
| 13 | `add-snippet-order.sql` | `snippets.sort_order`, which drives the 1–9 paste shortcuts. Needs 7. |

Files 12 and 13 arrived after `harden-functions.sql` and set
`search_path` on their own functions inline, so there is nothing left to
harden afterwards.

One trap worth knowing about: `fix-rls.sql` clears policies by querying
`pg_policies` for `organizations`, `org_members` and `servers`, so it
removes whatever it finds — including the folder-scoped policies that
`add-server-folders.sql` adds to `servers`. Re-running it on a database
that already has folders leaves those policies gone, so apply
`add-server-folders.sql` again afterwards.

## Email templates

`templates/` holds the branded Supabase auth emails — `confirm-signup.html`,
`invite.html` and `reset-password.html`. Paste them into
Authentication → Emails in the Supabase dashboard; they are not applied by
any of the SQL above.
