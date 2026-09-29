# Heterogeneous Harness Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 기존 cooperative 통신을 보존하면서 호스트 설정과 실연동 시험을 어댑터로 분리하고 세 도구 사이 6방향 통신을 검증한다.

**Architecture:** Runtime은 큐·작업·결과의 기준을 유지한다. 설정 registry와 live-lab host adapter를 분리하며 harness와 모델 설정을 혼용하지 않는다. 자동 실행 scheduler/ownership DB는 이 계획에 넣지 않는다.

**Tech Stack:** TypeScript, Node >=24, 기존 MCP SDK, node:test, 현재 SQLite schema 3.

**Spec:** ../specs/2026-09-30-heterogeneous-adapters-design.md §§1–5, 8–10 (P0/P1)

## Global Constraints

- 같은 컴퓨터의 Claude Code·Codex·OpenCode 이종 협업이 목표다.
- credential·기존 session ID·message cursor·artifact hash를 보존한다. 이 단계는 DB migration을 하지 않는다.
- 기존 `register --provider`와 `setup --host`를 호환 별칭으로 유지한다.
- 모델 제공자·모델·capability 미확인값을 추정하지 않는다.
- unsupported, blocked, not-tested를 passed로 집계하지 않는다.
- 실제 호스트 사용량과 테스트 SDK 호출을 별도로 기록한다. 기본 probe는 유료 호출을 하지 않는다.
- 외부 업로드는 docs/PUBLICATION-POLICY.md와 기존 공개 배포 계획의 조건을 충족해야 한다.

## Review Focus

- 설치 경로·credential 경로에 공백/유니코드가 있어도 실제 parser가 읽을 것 — Task 1.
- 구형 CLI 옵션과 새 옵션이 충돌하면 변경 전에 거절할 것 — Task 2.
- 로그인 흔적은 있지만 실제 인증이 만료된 경우 성공으로 표시하지 않을 것 — Task 3.
- 재귀 src 구조를 도입해도 npm tarball에 새 모듈이 누락되지 않을 것 — Task 1.
- 프로세스 exit 0인데 결과가 없거나 이전 실행 결과만 있는 경우 실패할 것 — Task 4.

## 파일 구조와 경계

| 파일 | 책임 |
| --- | --- |
| src/harnesses/types.ts | HarnessId, bridge configuration, config output 타입 |
| src/harnesses/registry.ts | 지원 ID 조회와 legacy alias 정규화 |
| src/harnesses/codex.ts, claude-code.ts, opencode.ts | 순수 MCP 설정 렌더링 |
| src/setup.ts | credential 검증, 경로 결정, wx/0600 쓰기 |
| src/cli.ts, src/runtime.ts | CLI/등록 요청 별칭 검증과 호환 |
| scripts/lib/host-adapters/*.mjs | 호스트 launch/auth/event 변환 (시험 전용) |
| scripts/host-lab.mjs | 시나리오, deadline, cleanup, 저장된 결과 검증 |
| scripts/host-matrix.mjs | 6방향 실행과 blocked/pass/fail 집계 |
| scripts/lib/package-check.mjs | 재귀 src와 dist 대응 및 좁은 tarball allowlist |

## Task 1: 설정 registry와 패키지 구조

**Files:** 신규 src/harnesses/{types,registry,codex,claude-code,opencode}.ts, tests/harnesses.test.ts. 수정 src/setup.ts, tests/setup.test.ts, scripts/lib/package-check.mjs, tests/package-artifact.test.mjs.

**Interfaces:** `HarnessId = 'claude-code' | 'codex' | 'opencode'`; `BridgeConfig = {command:string,args:string[]}`; `RenderedConfig = {format:'json'|'toml',text:string}`. `getHarness(id:HarnessId)`는 `{id,renderMcpConfig(bridge:BridgeConfig):RenderedConfig}`를 반환한다. file IO와 credential 검증은 setup에 남긴다.

- [x] `renders distinct per-session paths without token` 테스트: 각 호스트의 공백/유니코드 경로, 서로 다른 credential, token 미포함, 기존 wx 거절을 확인한다.
- [x] `nested emitted module is mandatory in tarball` 테스트: src/harnesses/registry.ts에 대응하는 dist/harnesses/registry.js 또는 .d.ts를 뺀 tarball은 실패하고, 정상 재귀 모듈은 허용한다. .durebak/private.json은 계속 거절한다.
- [x] `node --import tsx --test tests/harnesses.test.ts tests/setup.test.ts`로 새 registry가 없어 실패하는지 확인한다.
- [x] registry와 renderer를 구현하고 setup의 host별 분기를 위임한다. package 검사기는 src를 재귀 탐색하며 허용된 dist 하위 js/d.ts만 수용한다. 경로 traversal과 중복 tar entry 거절을 유지한다.
- [x] `npm run check && npm test && npm run package:check && npm run package:smoke` 통과. 설치된 실제 Codex parser로 임시 프로필 설정을 검증한다.
- [x] 독립 커밋: `refactor: separate harness configuration adapters`.

## Task 2: 명칭 호환과 충돌 검증

**Files:** src/harnesses/registry.ts, src/cli.ts, src/runtime.ts, tests/harnesses.test.ts, tests/cli-mcp.test.ts, docs/USAGE.md.

**Interfaces:** `resolveHarness(primary?:string,legacy?:string):HarnessId|'other'`. `claude`는 `claude-code`와 동등하며 unknown 값/서로 다른 값은 DomainError로 거절한다. `legacyProvider(id)`는 현재 DB 값 claude/codex/opencode/other를 반환한다. setup은 other를 지원하지 않는다.

- [x] 새 `--harness` 등록/setup, 기존 옵션 단독, 동등 별칭 동시 지정은 성공하고 codex/claude 충돌은 파일·DB 변경 전에 실패하는 CLI 테스트를 추가한다.
- [x] HTTP register는 기존 provider와 신규 harness 입력을 같은 정규화 규칙으로 처리하고, 둘 다 없거나 충돌하면 거절하는 테스트를 추가한다.
- [x] 실패 확인 후 구현한다. 기존 credential JSON 구조와 DB provider는 유지한다. API 응답에 신규 필드를 강제로 추가하거나 modelProvider를 추정하지 않는다.
- [x] `npm run check && npm test` 및 legacy register→MCP 송수신 통과.
- [x] 문서에서 host(머신)/harness(도구) 및 legacy flag를 설명하고 커밋한다.

## Task 3: 실연동 호스트 어댑터와 대칭 선택

**Files:** 신규 scripts/lib/host-adapters/{index,codex,claude-code,opencode}.mjs, tests/host-adapters.test.mjs. 수정 scripts/host-lab.mjs, scripts/lib/host-lab.mjs.

**Interfaces:** `getHostAdapter(harness)` → `{probe,buildInvocation,classifyFrame}`. `probe({signal})` → `{installed,version,authEvidence:'none'|'credentials_present'|'unknown'}`. `buildInvocation({sessionFile,workspace,configDir,allowedTools,model})` → `{command,args,env}`. `classifyFrame(frame)` → normalized tool/result/error/usage event 또는 null. 이 인터페이스는 시험용이며 제품 실행기와 구분한다.

- [x] `--worker codex --reviewer claude`만 가능한 현재 구조 대신 양쪽 모두 세 harness 선택이 가능한 테스트를 추가한다. 기존 --reviewer claude 호출은 동작을 유지한다.
- [x] 각 adapter의 실제 해당 버전 stream fixture를 비밀·본문 없이 최소 합성 fixture로 만든다. 인증 만료, tool failure, usage 없음, 알 수 없는 이벤트를 검증한다. 없는 필드는 0/success로 보정하지 않는다.
- [x] targeted tests 실패를 확인한다. 현재 문서와 설치 CLI help를 읽어 정확한 실행 인자를 고정하고 구현한다. 임의 default 모델이나 자동 계정 전환을 넣지 않는다.
- [x] OpenCode 연결은 기존 사용자 config를 수정하지 않는 임시 설정을 사용한다. 합쳐지는 project/managed config가 identity를 바꿀 수 있으면 effective config를 확인하거나 blocked 처리한다.
- [x] `node --test tests/host-adapters.test.mjs tests/host-lab.test.mjs`와 전체 검사 통과. CLI 미설치는 명시적 blocked로 종료한다.
- [x] adapter와 시나리오 분리 커밋. 실 사용자 credential·transcript는 커밋하지 않는다.

## Task 4: 6방향 매트릭스와 완료 증거

**Files:** 신규 scripts/host-matrix.mjs, tests/host-matrix.test.mjs. 수정 scripts/host-lab.mjs, docs/COMPATIBILITY.md, integrations/*/README.md. 비민감 실행 보고서 docs/testing/.

**Interfaces:** ordered pair는 (codex,claude-code), (claude-code,codex), (codex,opencode), (opencode,codex), (claude-code,opencode), (opencode,claude-code). 결과는 `{worker,reviewer,status:'passed'|'failed'|'blocked'|'not-tested',reason,evidence}`. 전체 passed는 6개 모두 passed일 때만 가능하다.

- [x] 6개 조합의 중복/누락 없음, blocked 하나면 전체 통과 아님, exit 0이지만 artifact/ack/correlation 누락이면 실패, 이전 nonce의 결과면 실패하는 테스트를 추가한다.
- [x] 실패 확인 후 matrix runner를 구현한다. 기본은 설치/인증 준비 상태만 점검하고, `--live`에서 유료 시험을 실행한다. 조합은 순차 실행하고 기존 90초 step deadline/Claude 회당 1달러 제한을 보존한다. 추가 모델별 예산은 확인 가능한 경우에만 적용하고 적용 여부를 보고한다.
- [x] 실제 worker→reviewer→worker 요청·ack·correlated reply·claim·artifact·complete를 검증한다. 같은 두레박 identity와 같은 native 대화 재개는 따로 표시한다.
- [x] 전체 unit/integration 및 tarball smoke를 통과시킨다. 실제 인증이 유효한 조합만 실행하고, 한 호스트가 auth 실패하면 그 호스트를 포함한 나머지 조합은 중복 호출 없이 blocked로 기록한다.
- [x] 보고서 공개 전 경로/credential/원문 대화를 검사한다. docs/COMPATIBILITY.md를 실제 근거만으로 갱신하고 커밋한다.

## Task 5: 공개 준비 연결 및 최종 검토

**Files:** docs/PUBLICATION-POLICY.md, docs/COMPATIBILITY.md, 기존 공개 배포 계획. 필요 시 package files allowlist.

- [x] `.gitignore` 검증에서 .durebak/reports, credential, release artifacts는 제외되고 ADR·플러그인 manifest·fixture는 추적 가능한지 확인한다.
- [x] `npm run repo:check`, actionlint, Node 24/26 전체 테스트, fresh checkout 설치, 동일 tarball 검사를 실행한다.
- [x] 한 번의 독립 전체 변경 리뷰로 legacy 호환·비밀 유출·이종 성공 주장·패키지 누락을 확인하고 중요한 문제를 재현/수정한다.
- [x] 로컬 commit/merge 완료 (`8f9fd86`), 머지 후 60/60 테스트 통과. 실제 GitHub/npm 작업은 2026-09-29-public-release.md의 미완료 조건을 따른다. 공개 owner/로그인/신고 경로를 추정하지 않는다.

## 이후 별도 계획으로 남기는 범위

Spec §§6–7의 managed state machine, native owner/epoch, approval callback, submit/reconcile, cancel/stop, replay 복구는 P2의 native/ACP 비교 결과 후 별도 계획으로 구체화한다. P3 자동 대기/깨우기와 bounded review loop도 별도 계획이다. 이 계획의 완료를 자동 오케스트레이션 완성으로 표현하지 않는다.

## 자기 검토와 실행 방식

P0/P1은 Tasks 1–4에 대응하고 공개 준비는 Task 5 및 기존 release 계획을 재사용한다. 다섯 Review Focus는 각 task의 실패 테스트에 배정했다. 연결 registry와 live-lab adapter는 책임이 다르고 모델 profile 확장은 아직 범위 밖이다.

권장 실행은 현재 세션에서 순차 구현하고 마지막에 한 번 독립 리뷰하는 방식이다. 공유 타입/설정 출력/패키지 검사가 서로 의존하므로 작업마다 새 agent를 투입하는 비용을 줄인다. Tasks 1–4 구현과 검증을 완료했다. 실제 이종 매트릭스는 Claude 인증 만료와 OpenCode 미설치로 blocked이며 성공으로 간주하지 않는다. Task 5 독립 리뷰의 중요 문제 2건은 재현 테스트 후 수정했고 Node 24/26에서 최종 60개 테스트가 통과했다. 로컬 통합 후 외부 배포 조건은 계속 미완료로 남긴다.
