---
name: deploy
description: Deploy, check, or roll back the os-taxonomy-beijing service at http://69.5.7.240:3000 through SSH host arkbot. Use when publishing the current project, checking its production revision or health, restarting the service, or rolling it back.
---

# Deploy OS Taxonomy Beijing

Deploy only committed Git revisions from `main`. Production is the Git worktree `/root/ai/os-taxonomy-beijing` on `arkbot`; it runs in tmux session `kg` and loads its server-only `.env`.

## Preflight

1. Inspect the local branch and working tree. Refuse deploy when the working tree is dirty or branch is not `main`.
2. Run the relevant verification for the requested change. For normal code deploys, run `npm test`.
3. Push `HEAD` with `git push origin main` and retain its full SHA.
4. Do not print, copy, commit, or replace production `.env`.

## Deploy

Run these remote commands through `ssh arkbot`, substituting the pushed SHA for `<sha>`:

```sh
git -C /root/ai/os-taxonomy-beijing fetch origin main
git -C /root/ai/os-taxonomy-beijing checkout --detach <sha>
tmux kill-session -t kg 2>/dev/null || true
tmux new-session -d -s kg 'cd /root/ai/os-taxonomy-beijing && exec node --env-file=.env scripts/serve.mjs --host 0.0.0.0 --port 3000 --upstream /root/ai/os-taxonomy'
```

Never use `git reset --hard`, `git clean`, or `rsync`: the server-only `.env` is not in Git and must survive deployments.

## Verify

1. Confirm the remote `HEAD` equals `<sha>` and tmux `kg` has a running Node process.
2. From the deployer, request `http://69.5.7.240:3000/api/summary`; require HTTP 200 and valid JSON.
3. For a frontend change, request the changed static route and require HTTP 200.
4. Report the deployed SHA and exact checks performed.

## Status

Compare local `HEAD`, remote `HEAD`, the `kg` tmux process, and `/api/summary`. Treat a mismatch or non-200 response as unhealthy; do not claim deployment succeeded.

## Rollback

Require an explicit previously deployed SHA. Verify it exists in the remote repository, checkout it detached, restart `kg` with the same command, and repeat the verification steps.
