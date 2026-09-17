@AGENTS.md

Before any bookkeeping or finance work (ledger, bank feeds, payroll posting, reports, invoices, payments), read `docs/architecture/books-build.md`. It is the source of truth for the QuickBooks replacement.

## One session, one worktree — never share a checkout

**Two Claude sessions must never work in the same checkout or worktree.** A shared
working tree means a shared index: one session stages while another commits, and
the second silently commits the first's half-finished edits. It has happened here.

Every session creates its own worktree before editing anything:

```
git worktree add ../anexa-<branch> -b <branch> origin/main
```

**Before editing an existing worktree, check that no other session is using it.**
`git worktree list` shows every checkout and the branch each has; a directory that
another session is working in is not available, whatever its state looks like.
Prune stale ones (`git worktree prune`) rather than adopting them.

Each new worktree needs its own install — `pnpm install --frozen-lockfile
--prefer-offline` then `pnpm exec prisma generate`. Never symlink `node_modules`
from a sibling worktree: the Prisma client is generated per tree and a borrowed
one fails at runtime, not at build time.
