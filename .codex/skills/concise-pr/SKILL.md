---
name: concise-pr
description: Commit a scoped working-tree change, push its branch, and open or update a GitHub pull request with a concise bullet-only description. Use when the user asks to create a PR and wants short titled bullets instead of a template-heavy body.
---

# Concise PR

Create the requested PR without absorbing unrelated working-tree changes.

1. Read the repository instructions, inspect remotes, status, current branch, and the diff against the intended base. Resolve the base from the user's request; otherwise use the remote default branch.
2. Identify the exact requested changes. Preserve unrelated edits and stage only the relevant files or hunks. Run affected tests, typecheck, lint, and any repository-required review or live UI verification proportionate to the change.
3. Create a focused branch when needed, commit without AI-attribution trailers, push it, and open the PR. Do not merge unless explicitly asked.
4. Keep the PR description concise and bullet-only. Every bullet must use this exact shape on one line: `- **Two to Five Words** One or two sentences describing the concrete change or validation.`
5. Use two to five bullets unless the scope genuinely needs more. Cover behavior before implementation detail, avoid headings and boilerplate, and mention testing in a final bullet when useful.
6. Re-read the published title, body, base, head, and changed-file list. Report the PR URL and any intentionally excluded local changes.

If an existing PR already uses the branch, update it instead of opening a duplicate. Invoking this skill authorizes the requested commit, push, and PR creation, but not deployment or merge.
