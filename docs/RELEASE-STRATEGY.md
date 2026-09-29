# 두레박 공개 배포 전략

작성: 2026-09-29. 상태: 제안·실행 전. 저장소 생성, push, npm publish, marketplace 등록은 아직 수행하지 않았다.

## 권장 결정

GitHub를 소스·문서·이슈·릴리스의 기준으로, npm을 CLI/daemon/MCP 실행 프로그램의 설치 경로로 사용한다. 호스트별 플러그인·스킬은 같은 런타임을 연결하는 얇은 계층으로 만든다. 처음에는 저장소 하나로 관리한다. 두레박 런타임은 사용자 컴퓨터에서 실행하므로 별도 클라우드 서버·유료 도메인은 첫 배포에 필요하지 않다.

| 채널 | 제공물 | 시점 |
|---|---|---|
| GitHub public repository | Apache-2.0 소스, 문서, 이슈, 기여 규칙 | 공개 이력 점검 후 가장 먼저 |
| GitHub Releases | 버전별 변경점, 검증 보고서, 검증한 npm tgz와 checksum | npm 알파와 같은 버전 |
| npm public package | durebak 실행 파일, daemon, stdio MCP | 설치·복구·배포 검증 후 |
| Codex / Claude marketplace | 안내 skill 및 호스트별 연결 템플릿 | 세션 identity 분리 검증 후 |
| OpenCode 설정 | local MCP 설정 생성 | 실제 OpenCode 검증 후 |
| 문서 사이트 / Homebrew / 독립 바이너리 | 추가 발견·설치 경로 | 사용자 수요가 확인된 뒤 |

GitHub Packages는 첫 배포의 npm 설치 경로로 사용하지 않는다. 배포 채널마다 런타임 복사본을 따로 관리하지 않는다. Docker는 같은 컴퓨터의 세션·경로·권한 연결을 복잡하게 하므로 초기에 제공하지 않는다.

## 현재 상태와 간극

- 구현: Node >=24, TypeScript, 로컬 SQLite, Apache-2.0, CLI/MCP, 큐 정책, npm 파일 allowlist, CI 설정.
- 직전 검증: macOS Node 24/26에서 37개 회귀 테스트 및 독립 npm tarball 설치 성공. 실제 Codex↔Codex 실험 보고서 존재.
- Git remote 없음. package.json은 private=true이며 repository/homepage/bugs/publishConfig가 없다. publish workflow와 CHANGELOG도 없다.
- Linux CI는 설정만 존재하고 원격 실행 증거가 없다. Windows는 파일 권한과 프로세스 종료 방식을 아직 지원 검증하지 않았다.
- Claude는 마지막 실험에서 인증 만료로 막혔고, OpenCode는 미설치·미검증이었다. 둘을 지원 완료로 광고하지 않는다.
- 설치용 plugin/skill, 세션별 설정 생성, doctor, 일반용 wait는 미구현이다.
- 긴급 메시지 예약 용량과 등록 credential 복구는 후속 개선 목록에 남아 있다.

private=true는 npm 출판 방지 장치다. GitHub 소스 공개와 별개이며 npm 출판을 결정한 릴리스 PR에서만 제거한다.

## 소유권과 이름

브랜드 Durebak / 두레박, 실행 명령 durebak은 유지한다. 공개 저장소는 개인 OWNER/durebak로 시작하는 안을 기본으로 하되 사용자 선택에 따라 조직 소유로 바꾼다. OWNER는 실제 확인한 계정·조직으로 확정한다.

npm의 durebak 이름 가용성이나 소유권은 아직 확인하지 않았다. 확보 가능하고 소유권이 확인되면 unscoped durebak을 사용하고, 아니면 소유한 npm scope의 @SCOPE/durebak을 사용한다. scope가 바뀌어도 bin 이름은 durebak이다. GitHub owner와 npm scope가 같다고 가정하지 않는다.

공개용 커밋 작성자 이름·이메일, 보안 신고 연락 경로, npm 계정과 2FA·복구 수단을 확정한다. 기존 이력 변경은 별도 합의 없이 하지 않는다.

## 첫 사용 경험

목표: 새 사용자가 문서만 보고 서로 다른 두 Codex 참여자를 연결하고 요청·답변·기록을 확인한다.

1. 검증된 정확한 버전의 npm 패키지를 설치한다. alpha 설치는 명시적으로 alpha 버전/태그를 선택한다.
2. foreground `durebak serve`로 daemon을 시작한다. 서비스 상주·자동 시작은 후속 기능이다.
3. 서로 다른 alias와 credential로 세션을 등록한다. credential은 저장소 밖 0600 파일이다.
4. 추가할 `durebak setup`이 세션별 MCP 설정 파일을 생성한다. 초기 버전에서는 전역 호스트 설정을 자동으로 덮어쓰지 않는다.
5. 각 호스트는 자기 credential로만 연결한다. `durebak doctor`로 Node·daemon·credential·protocol 호환성을 확인한다.
6. send → 외부 대기 → receive → ack(id,receipt) → replyTo 답변 → 결과 artifact 흐름을 수행한다.

setup/doctor는 계획된 명령이며 현재 설치 안내에 실행 가능한 명령으로 표기하지 않는다. 같은 credential이 모든 세션에 공유되는 고정 전역 MCP 구성은 제공하지 않는다. 스킬은 절차·도구 사용을 안내하고, 전달과 상태 저장은 MCP/daemon이 담당한다.

## 호스트별 배포 원칙

Codex: 현재 공식 문서는 root plugin.json/mcp.json의 portable 형식과 .codex-plugin/plugin.json 호환 형식을 설명한다. 지원 CLI 버전의 실제 로더로 검증한 한 형식을 선택한다. marketplace를 통한 저장소 배포와 공식 디렉터리 심사는 별도 단계다. 첫 알파는 자체 GitHub 배포로 충분하다. [OpenAI 공식 패키징 문서](https://developers.openai.com/plugins/build/plugins)

Claude: .claude-plugin/marketplace.json으로 자체 marketplace를 만들 수 있다. 호스트 전용 manifest를 Codex manifest와 무리하게 합치지 않는다. 재로그인 후 실제 설치와 서로 다른 credential의 양방향 통신을 검증한다. [Claude 공식 marketplace 문서](https://code.claude.com/docs/en/plugin-marketplaces)

OpenCode: 초기에는 local MCP 설정을 생성한다. 별도 JS plugin을 만들기보다 기존 MCP 연결로 요구사항을 충족하는지 먼저 확인한다. [OpenCode 공식 MCP 문서](https://opencode.ai/docs/mcp-servers/)

## 출시 단계와 통과 기준

A. GitHub 소스 공개: 소유권·보안 신고 경로·이력 점검 완료. remote 연결 후 macOS/Linux CI가 실제 통과한다. README 첫 화면에 cooperative alpha와 미지원 범위를 명시한다.

B. npm alpha: setup/doctor, 등록 실패 안내·복구 경로, exact-tarball 설치 시험, schema 1/2/3 업그레이드 시험, 큐 중요도·만료 회귀 통과. 우선 Codex 검증 완료로 공개하고 Claude/OpenCode는 experimental로 구분한다. 스킬/marketplace 없이도 수동 MCP 연결이 가능해야 한다.

C. 호스트별 플러그인: 설치·해제·업데이트와 세션별 identity 분리를 각 호스트에서 검증한 뒤 해당 호스트의 지원 배지를 올린다. 지원 버전과 마지막 검증일을 함께 기록한다.

D. stable: Linux·macOS 외부 사용자 검증, 장애 복구·등록 credential 재발급, API/DB 호환성 정책, 긴급 큐 포화 정책까지 확인한 뒤 latest로 승격한다. Windows·자동 wake·native resume는 별도 통과 기준이다.

## 릴리스와 업데이트

첫 후보는 0.1.0-alpha.1, npm dist-tag는 alpha로 제안한다. 사전 버전 문자열만 믿지 말고 태그를 명시해 latest 오염을 방지한다. MCP 설정은 정확한 버전을 사용하며 실행할 때마다 최신 버전을 자동 다운로드하지 않는다. [npm dist-tag](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/)

릴리스 PR → 전체 CI → 정확한 commit의 태그 → tgz 1회 빌드·검사·독립 설치 → 출판 → registry에서 그 버전 설치 확인 → GitHub Release 순서다. 검사한 tgz와 출판한 tgz가 같도록 checksum과 commit을 기록한다. 같은 버전을 덮어쓰지 않는다.

GitHub-hosted runner와 npm Trusted Publishing(OIDC)을 우선한다. npm >=11.5.1을 명시적으로 검증하고 Node 24의 검증된 patch 버전을 사용한다. owner/repo/workflow/environment 및 public repository URL을 정확히 연결한다. 공개 저장소·공개 패키지의 OIDC 출판은 provenance를 자동 생성한다. [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)

처음 패키지를 만드는 계정 절차와 이후 자동 출판은 구분한다. 최초 namespace/package 생성 경로를 해당 계정에서 확인하고, 필요한 최초 출판은 유지관리자가 로그인·2FA로 검증된 tgz를 출판한다. 이후 OIDC로 전환한다. 첫 자동화는 수동 승인된 릴리스에 한정하며, npm staged publishing 적용은 별도 검토한다. [npm staged publishing](https://docs.npmjs.com/staged-publishing/)

업그레이드 전 daemon을 정상 종료하고 DB/WAL 일관성을 보장하는 백업을 만든다. schema 3 감사 커서 초기화 안내를 포함한다. 실행 파일 버전 되돌리기는 DB downgrade가 아니다. 스키마가 바뀌었다면 호환 버전 또는 업그레이드 전 백업으로만 복구하며, 그 이후 메시지는 복원 범위 밖임을 알린다.

## 공개 저장소 운영

PR 필수 검사, main/tag 변경 제한, workflow 변경 검토, 최소 Actions 권한, Dependabot, issue 템플릿과 CHANGELOG를 준비한다. 출판 권한은 PR 검사 job에 주지 않는다. 패키지 검사에 credential·DB·로그·실제 대화가 포함되지 않는지 검증한다. GitHub private vulnerability reporting을 켜고 SECURITY.md에 실제 신고 링크를 넣는다. [GitHub 보안 신고 설정](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)

## 이번 계획에서 실행하지 않는 것

GitHub repository 생성·공개 전환·push, npm 이름 선점·publish, 사용자 호스트 설정 변경, 플러그인 설치는 실행하지 않았다. 계획 확정 후 각 단계의 준비물을 먼저 완성하고 실제 공개 작업을 진행한다.
