# Changelog

All notable changes to this portfolio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per-project changelogs live in `projects/<name>/CHANGELOG.md`.

## [Unreleased]

## [0.0.1] — 2026-05-28

### Added
- Initial portfolio scaffold: pnpm workspace, TypeScript strict base, ESLint flat config, Prettier, Husky + lint-staged, commitlint (Conventional Commits).
- CI workflow (lint, typecheck, test, build) and Lighthouse workflow (manual dispatch).
- Dependabot configuration for npm and GitHub Actions.
- Eight Claude Code subagents in `.claude/agents/` for delegated work.
- `docs/conventions.md` (stack policy, workflow, extraction triggers, do-not-share list) and `docs/inspirations.md` (visual references).
- MIT License.
