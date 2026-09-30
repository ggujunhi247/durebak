# Contributing to Durebak

Durebak (두레박) connects cooperative coding-agent sessions on one computer. Read README.md and docs/IMPLEMENTATION.md to distinguish running features from the broader product spec.

## Development

Use Node.js 24 or newer and npm. Run:

```sh
npm ci
npm run check
npm test
npm run package:check
```

Tests run real SQLite databases, loopback servers and MCP subprocesses in private temporary directories. Ordinary tests and `npm run lab` need no model account or paid API. `npm run lab:live` explicitly invokes authenticated hosts and consumes account usage; never put it in ordinary CI. CI targets Node 24 on macOS and Linux; WSL2/native Windows and actual provider UI integrations require separate validation.

## Change rules

- Write a failing behavior test before implementing a new contract or fixing a bug. Use real local components where practical.
- Derive sender and workspace from the credential; never accept them from a model tool argument.
- Preserve the distinction between sent, read, claimed and completed. Self-reported completion is not verified correctness.
- Preserve compare-and-swap task revisions, scoped artifacts, idempotency and restart durability. Schema changes need an explicit migration and compatibility tests.
- Keep tool output bounded, expose cursors and do not silently truncate mandatory criteria. No hidden LLM calls.
- Never include tokens, transcripts, runtime files, private paths or real project data in fixtures. Use synthetic data and temporary directories.
- No postinstall hooks or automatic host-config changes. Never publish from pull-request CI. Review both Git changes and `npm pack` contents.
- Do not claim Claude Code/Codex/OpenCode host compatibility from generic MCP tests alone. Record versions and actual tests.
- Keep Managed, Attached and Cooperative support separate; auto-wake and managed execution are future work.

## Public release preparation

The npm name is a local identifier, not a confirmed namespace reservation. Apache-2.0 is selected and the public repository is `ggujunhi247/durebak`. No contribution license agreement or ownership transfer is implied. Do not push or publish without the repository owner's instruction.

Before pushing, follow the [publication secret checks](SECURITY.md#publication-secret-checks), including installation of the local pre-push guard. Never upload raw scan reports.

## Documentation scope

Public documentation covers installation, operation, supported behavior, troubleshooting, contribution, security and release procedures. Keep internal research, implementation plans and per-run reports under the ignored `.durebak/private-docs/` directory. Summarize relevant verified limitations in the maintained manuals; do not link to private records. Moving a document out of the current tree does not remove earlier public Git history or tagged releases.
