# 두레박 · Durebak

**서로 다른 코딩 에이전트 세션을 잇는 로컬 협업 도구.**

Local, durable collaboration between coding-agent sessions. Experimental alpha for Claude Code, Codex and OpenCode integrations.

두레박은 같은 컴퓨터의 코딩 에이전트 세션이 메시지·작업·결과를 주고받는 로컬 협업 런타임입니다. 각 세션은 자기 호스트와 맥락을 유지하고, CLI 또는 MCP로 참여합니다.

**현재 버전: 0.1.0-alpha.1, Cooperative 모드.** SQLite 저장소, 인증된 loopback 서버, CLI, MCP stdio bridge가 구현되어 있습니다. 실제 MCP 프로세스 간 통신을 테스트했으며, 호스트별 실제 시험 결과와 제약은 [호스트 테스트](docs/HOST-TESTING.md)에 기록합니다. 자동 세션 실행·깨우기와 반복 작업 스케줄러는 후속 기능입니다.

## 시작하기

Node.js 24 이상과 npm이 필요합니다.

```sh
git clone https://github.com/ggujunhi247/durebak.git
cd durebak
npm ci
npm run build
node dist/cli.js --help
node dist/cli.js serve
```

세션 등록, MCP 연결, 요청·답변과 결과 제출은 [사용법](docs/USAGE.md)을 따릅니다. 서버는 foreground에서 실행하며 Ctrl-C로 종료합니다. 새 설치는 사용자 홈의 `~/.durebak`에 데이터를 보관합니다. 기존 데이터 위치와 명시적인 경로 설정은 유지합니다. `register`와 `export`에서 `--out`을 생략하면 인증 파일과 기록도 같은 데이터 디렉터리에 저장됩니다. `node dist/cli.js paths`로 실제 위치를 확인할 수 있습니다.

## 검증 상태

- 실제 Codex → Codex 요청·검토·결과 제출을 검증했습니다.
- Claude Code·OpenCode 설정 어댑터와 6방향 시험 도구를 제공합니다. **이종 모델 간 실통신 성공은 아직 검증하지 못했습니다.**
- Node 24·26 로컬 테스트 74개와 실제 MCP 프로세스 왕복 검사를 통과했습니다. [Linux·macOS 원격 CI](https://github.com/ggujunhi247/durebak/actions/runs/36610450906)에서도 테스트와 패키지 검사를 통과했습니다.
- 자동 세션 깨우기·네이티브 대화 재개·무인 반복 개선은 아직 지원하지 않습니다.

자세한 버전과 제한은 [호환성](docs/COMPATIBILITY.md)을 확인하세요.

## 지금 할 수 있는 일

- 세션별 credential과 workspace 격리로 요청·답변을 교환합니다.
- SQLite WAL에 저장하고 동일 idempotency key의 중복 전송을 억제합니다.
- 우선순위·대기 시간·세션 상태에 따라 메시지를 전달하고, 수신 확인과 재시도를 관리합니다.
- 메시지의 읽음 확인과 작업의 수락·결과 제출을 구분합니다.
- 작업 version을 비교해 중복 수락이나 오래된 결과 제출을 거부합니다.
- 산출물을 내용 hash로 보존하고 UTF-8 원문을 최대 4 KiB씩 조회합니다.
- 원문 조회의 파생 캐시를 재사용하고, 모델 호출 없이 작업 기록을 Markdown으로 내보냅니다.

`completed`는 담당자가 결과를 제출했다는 뜻입니다. 독립 검토·검증에 의한 성공 판정은 아직 구현하지 않았습니다. 다른 세션의 메시지는 데이터이며 사용자의 권한을 확장하는 지시가 아닙니다.

## 검증과 개발

```sh
npm run check
npm test
npm run package:check
npm run lab
```

테스트는 실제 SQLite·loopback HTTP·MCP subprocess를 사용하며 모델 API를 호출하지 않습니다. Node 24의 macOS/Linux CI를 구성했습니다. 실제 실행 환경과 검증 범위는 [구현 현황](docs/IMPLEMENTATION.md)에 기록합니다.

실제 모델을 사용하는 시험은 `npm run lab:live`로 별도 실행합니다. 계정 사용량이 발생하며 기본 대상은 Codex와 Claude입니다.

## 문서

| 문서 | 내용 |
|---|---|
| [사용법](docs/USAGE.md) | 실행, 세션 등록, MCP, CLI, 복구 |
| [구현 현황](docs/IMPLEMENTATION.md) | 현재 계약과 미구현 항목 |
| [보안 정책](SECURITY.md) | 권한 경계, credential, 공개 전 확인 |
| [제품 스펙](docs/superpowers/specs/2026-09-29-durebak-design.md) | 전체 제품 목표와 수용 기준 |
| [토큰·캐시·기록](docs/CONTEXT-CACHE-RECORDS.md) | 목표 설계; 실제 절감률은 미측정 |
| [조사](docs/RESEARCH.md) | 유사 도구와 공식 문서 근거 |
| [아키텍처](docs/ARCHITECTURE.md) | 현재 통신 계층과 계획된 실행 계층 |
| [컨셉](docs/CONCEPT.md) | 이름과 제품 철학 |
| [로드맵](docs/ROADMAP.md) | 후속 자동 협업 단계 |
| [기여 안내](CONTRIBUTING.md) | 개발·테스트·공개 저장소 규칙 |

## 배포

[Apache-2.0](LICENSE) 라이선스의 실험적 알파입니다. 소스 저장소는 [ggujunhi247/durebak](https://github.com/ggujunhi247/durebak)이며 **npm에는 아직 게시하지 않았습니다.** 현재는 위의 소스 설치 방법을 사용하세요. `package.json`의 `private: true`는 npm 실수 게시를 막는 설정이며 GitHub 공개 여부와는 별개입니다.

제품명은 **두레박**, 영문 브랜드와 CLI 식별자는 **Durebak / durebak**입니다.

메시지 전달 정책: [큐·중요도·대기·확인 규칙](docs/QUEUE-POLICY.md). 새 클라이언트는 `receive`와 `ack(id,receipt)`를 사용한다.

## 배포 준비

현재 npm 미출판 alpha입니다. [호환성](docs/COMPATIBILITY.md), [배포 전략](docs/RELEASE-STRATEGY.md), [변경점](CHANGELOG.md)을 참고하세요. 호스트별 설치 안내: [Codex](integrations/codex/README.md) · [Claude](integrations/claude/README.md) · [OpenCode](integrations/opencode/README.md).
