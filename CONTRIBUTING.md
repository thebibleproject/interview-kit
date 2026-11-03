# Contributing

This repository uses [lefthook](https://lefthook.dev) for git hooks and [rumdl](https://rumdl.dev) for Markdown linting.

## Setup

After cloning, run once from the repository root:

```sh
npm install
```

This installs both tools and registers the `pre-commit` hook. On each commit, the hook runs `rumdl check --fix` on staged Markdown files and stages the result.

## Manual checks

```sh
npm run lint      # check all Markdown
npm run lint:fix  # fix all Markdown
```

To skip the hook for one commit, use `LEFTHOOK=0 git commit ...`.
