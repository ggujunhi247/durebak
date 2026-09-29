# Durebak Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 사용자가 공개 소스 또는 npm 배포본으로 독립된 두 세션의 실제 통신을 재현할 수 있게 한다.

**Architecture:** GitHub 저장소 하나와 npm 런타임 하나를 기준으로 한다. 호스트별 설치 자산은 세션별 credential을 사용하는 설정·skill을 제공한다. 공개 소스, npm alpha, 호스트 marketplace, stable 순서로 분리한다.

**Tech Stack:** TypeScript, Node >=24, SQLite schema 3, MCP stdio, npm, GitHub Actions.

**Spec:** ../../RELEASE-STRATEGY.md

## Global Constraints

- 브랜드 Durebak / 두레박, 실행 명령 durebak, Apache-2.0 유지.
- 첫 공개 지원 범위는 macOS·Linux의 cooperative runtime. 호스트 검증은 별도 표시.
- 자동 wake·native resume·Windows 지원을 검증 없이 주장하지 않는다.
- credential은 저장소 밖 0600, data directory는 0700. 토큰을 명령 인자·로그·배포물에 넣지 않는다.
- 현 단계는 계획이다. 이름·소유권 확정 전 외부 생성·출판을 수행하지 않는다.
- OWNER, PACKAGE, VERSION은 각각 실제 GitHub 소유자, 소유권 확인한 npm 이름, 릴리스 PR 버전으로 채운다. 추측한 계정명으로 실행하지 않는다.

## Review Focus

- 여러 호스트 창이 같은 credential을 사용하는 경우: 생성된 설정은 각 세션 ID를 구분해야 한다(Task 3).
- 첫 npm 출판/권한 부족: OIDC 구성 이전 bootstrap을 명시적으로 처리해야 한다(Task 4).
- 검사한 소스와 실제 tgz 불일치: 단일 artifact와 checksum을 출판까지 유지한다(Task 4).
- daemon 구버전·schema 신버전: 자동 재시도 대신 호환성 오류와 복구 절차를 보여준다(Task 3, 5).
- 계정 로그인 기록만 있고 API 인증 만료: 실제 호스트 통신 성공을 별도 증거로 요구한다(Task 5).

## Task 1: 소유권·공개 메타데이터 확정

**Files:** package.json, package-lock.json, README.md, SECURITY.md, CHANGELOG.md(신규), .github/ISSUE_TEMPLATE/bug.yml(신규), .github/ISSUE_TEMPLATE/feature.yml(신규).
**Interfaces:** 확정 OWNER/PACKAGE/VERSION을 후속 릴리스 작업에 제공한다.

- [ ] GitHub 개인/조직 소유자, npm 계정·scope, 공개 커밋 작성자, 신고 경로를 확정한다.
- [ ] registry에서 패키지 존재·소유권을 확인한다. 미존재만으로 예약 완료라 기록하지 않는다.
- [ ] repository/homepage/bugs와 지원 표·설치 안내를 실제 소유권에 맞춰 작성한다. npm private는 아직 유지한다.
- [ ] GitHub 공개 저장소 생성·push 전 공개할 이력과 파일 목록을 검토한다. 사용자의 공개 실행 지시를 확인한 후 remote를 연결한다.
- [ ] 완료 조건: GitHub에서 README·LICENSE·SECURITY·이슈 템플릿 확인, 실제 원격 CI 링크 확보.

## Task 2: 검사와 배포물 일치

**Files:** .github/workflows/ci.yml, .github/dependabot.yml(신규), scripts/check-package.mjs, scripts/smoke-package.mjs, src/version.ts(신규), src/cli.ts, src/mcp.ts, tests/release.test.mjs(신규).
**Interfaces:** `smoke-package.mjs --tarball PATH`는 이미 만든 tgz를 설치해 검증하며 새로 pack하지 않는다. package.json 버전을 CLI/MCP 버전의 단일 기준으로 사용한다.

- [x] 테스트 추가: CLI/MCP/package 버전 불일치, 새 dist 모듈 누락, 금지 파일 포함, 지정 tgz 대신 재빌드한 경우 실패한다.
- [x] 새 테스트 실패를 확인하고 버전 공통화·tgz 입력 경로를 구현한다.
- [ ] macOS/Linux Node 24에서 check/test/package 검사와 동일 tgz smoke를 수행한다. Actions는 검증한 commit SHA로 고정한다.
- [ ] 완료 조건: 외부 CI 양쪽 OS 통과, 각 배포 파일 목록·tgz SHA-256 기록, 신규 clone에서 빌드 성공.
- [ ] 변경을 커밋한다.

## Task 3: 세션별 설치와 진단

**Files:** src/setup.ts(신규), src/doctor.ts(신규), src/cli.ts, src/client.ts, src/runtime.ts, tests/setup.test.ts(신규), docs/USAGE.md.
**Interfaces:** 계획 명령 `durebak setup --host codex|claude|opencode --session FILE --out FILE`; `durebak doctor --session FILE`. setup은 설정 파일만 만들고 호스트를 실행하지 않는다.

- [ ] 테스트 추가: 세션 두 개는 서로 다른 credential 경로를 생성, 기존 파일은 덮어쓰지 않음, 공백 경로 보존, token 원문이 설정·stdout에 없음, daemon 미실행/권한 회수/호환성 불일치를 구분한다.
- [x] 실패 확인 후 호스트별 설정 출력과 로컬 진단을 구현한다. 버전 조회가 필요하면 credential 인증된 runtime 진단 API를 추가하고 민감 경로·token을 반환하지 않는다.
- [ ] 임시 프로필에서 생성 설정을 각 지원 호스트의 실제 parser로 검증한다. 현재 호스트 버전의 공식 schema를 확인한다.
- [ ] 완료 조건: 새 디렉터리의 서로 다른 Codex 두 참여자가 생성 설정만으로 양방향 통신. 수동 MCP 대체 절차도 문서화.
- [ ] 변경을 커밋한다.

## Task 4: npm alpha 출판 절차

**Files:** .github/workflows/release.yml(신규), scripts/check-release.mjs(신규), tests/release.test.mjs, package.json, CHANGELOG.md.
**Interfaces:** 릴리스 job은 main에 포함된 VERSION tag commit → 검증한 tgz 1개 → npm alpha → GitHub prerelease를 생성한다.

- [x] 테스트 추가: tag/package 버전 불일치, prerelease에 latest 사용, main에 없는 commit, private=true, 소유권 메타데이터 누락은 출판 전에 실패한다.
- [x] 실패 확인 후 릴리스 검증기를 구현한다. release job의 Node/npm 버전과 OIDC owner/repo/workflow/environment를 명시한다. 출판 job만 id-token 권한을 받는다.
- [x] 먼저 출판 없는 rehearsal로 tgz·checksum·검사 증거를 만든다. 검증된 바로 그 tgz를 설치해 확인한다.
- [ ] 최초 npm package bootstrap이 필요한지 계정에서 확인한다. 필요한 최초 출판은 유지관리자 로그인·2FA로 검토된 tgz를 사용한다. 이후 Trusted Publishing을 연결한다.
- [ ] alpha 출판을 결정한 릴리스 PR에서 private를 제거하고 publishConfig.access=public을 설정한다. 버전/tag와 승인 대상을 명확히 한 뒤 실제 출판한다.
- [ ] 완료 조건: registry의 정확한 VERSION을 새 환경에 설치해 동작 확인, provenance/출처 확인, GitHub prerelease와 변경점·복구 안내 공개. 동일 버전 재출판 금지.

## Task 5: 호스트별 배포 자산과 호환성

**Files:** integrations/codex/README.md(신규), integrations/claude/README.md(신규), integrations/opencode/README.md(신규), plugins/codex/(신규), plugins/claude/(신규), skills/durebak/SKILL.md(신규), docs/COMPATIBILITY.md(신규), scripts/host-lab.mjs.
**Interfaces:** 세션별 설정은 Task 3 산출물을 사용한다. skill은 send/receive/ack와 대기·중복 처리 규칙을 안내하고 런타임 상태의 기준이 되지 않는다.

- [x] Codex plugin-creator 및 skill-creator 지침과 현재 호스트 공식 manifest를 확인해 작은 설치 자산을 생성한다. portable/호환 manifest 중 검증한 형식을 명시한다.
- [ ] 전역 고정 credential을 배포하지 않는다. 설치·해제·정확한 버전 업데이트를 임시 프로필에서 검증한다.
- [ ] Codex↔Codex, Codex↔Claude, Codex↔OpenCode를 실제 실행한다. 실패·미설치는 experimental로 남긴다. 합성 기대값이 주어진 통신 검증과 자율 작업 수행을 구분한다.
- [ ] DB schema 업그레이드와 백업 복구 시험, 같은 workspace의 두 credential 격리, 최초 전달 커서 초기화를 확인한다.
- [ ] 완료 조건: 각 지원 표시마다 호스트 버전·시험 날짜·비민감 보고서 존재. 외부 사용자가 문서만 보고 재현한 피드백 확보.
- [ ] marketplace 공개는 해당 호스트 설치 검증 후 별도로 진행한다. 공식 디렉터리 등록은 첫 npm alpha의 의존성이 아니다.

## 실행 순서와 종료 기준

Task 1 → Task 2 → Task 3 → Task 4로 npm alpha를 완성하고, Task 5는 호스트별로 순차 확장한다. GitHub 소스 공개는 Task 1의 검토 후 먼저 가능하다. 긴급 큐 예약 용량·credential 재발급·일반 wait는 별도 후속 계획으로 처리하고 stable 이전에 운영 적합성을 판정한다.

실행 현황 (2026-09-29): 로컬 설치·진단, 버전 공통화, 지정 tgz 검사, release guard, CI/release workflow, 공유 skill/plugin과 통합 문서를 구현했다. Node 24/26 각 44개 테스트, 동일 tgz 설치 smoke, Codex 생성 설정 실통신(10 MCP 호출/11 근거 검사), Codex TOML parser 및 두 플러그인 manifest 검증을 통과했다. 증거는 docs/testing의 release-setup-live 및 release-rehearsal 보고서에 있다.

Task 1 소유자·로그인·공개 작성자 확정, 실제 GitHub 생성/push/CI, npm bootstrap/OIDC/출판, Claude/OpenCode 실통신, marketplace 설치/해제 및 외부 사용자 재현은 미완료다. 해당 완료 조건은 체크하지 않았다. 계정 토큰을 받거나 추측한 owner로 외부 변경을 수행하지 않았다.

구현 선택: 중복을 줄이기 위해 plugins/durebak 한 폴더에 양쪽 manifest와 canonical skill을 둔다. npm pretest는 setup이 참조하는 dist를 먼저 빌드한다. private=true를 유지하므로 현재 출판 실행은 차단된다.
