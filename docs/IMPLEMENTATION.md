# 구현 현황 — 0.1.0-alpha.1

이 문서는 실행 가능한 범위를 설명한다. 전체 제품 스펙 v0.4는 목표 계약이며 이 alpha에서 모두 충족하지 않는다.

## 구현된 계약

| 영역 | 동작과 한계 |
|---|---|
| 런타임 | 데이터 디렉터리당 foreground daemon 하나, 127.0.0.1 임의 포트, HTTP JSON 인증 |
| 참여 | 사용자 CLI 등록, 고정 credential MCP bridge; provider 표시는 실제 호스트 검증이 아님 |
| 인증 | admin/session 분리, token hash 저장, 회수, Origin/Host 검사 |
| 격리 | canonical workspace 경로 hash; 세션 workspace는 서버가 credential에서 결정 |
| 메시지 | 정책 기반 durable queue, request/reply, 보낸이·받는이만 본문 조회, idempotency conflict, pending 100개 backpressure |
| 읽음 | receive의 30초 lease·receipt 기반 ack, 5회 한도 재전달·TTL 만료; 조회·읽음·작업 완료를 분리 |
| 작업 | 생성·목록·조회, version 기반 원자적 claim, 수락자 결과 제출, 생성자 취소 |
| 산출물 | 최대 64 KiB UTF-8 텍스트, workspace별 SHA-256 불변 원본 |
| 조회 | cursor 페이지, 원문 최대 4096 bytes; HTTP 응답 최대 16 KiB |
| 캐시 | workspace/hash/range/가공기 버전 key, 파생 데이터만 삭제, workspace 256 MiB LRU |
| 기록 | DB 기준 결정적 Markdown, LLM 0회, 명시적 export만 파일 생성, 덮어쓰기 충돌 거부 |
| 복구 | 정상 재시작 후 session token·메시지·작업 유지. 강제 종료 stale lock은 사람이 종료 확인 후 제거 |
| 배포 준비 | Apache-2.0, lockfile, ignore 규칙, npm allowlist 검사, CI, 보안·기여 문서 |

## 아직 구현하지 않은 계약

- Managed/Attached provider adapter, 활성 호스트의 identity 검증·재연결·자동 wake.
- 작업 DAG, 검토→수정→검증 자동 라운드, 정책 digest·독립 증거를 이용한 완료 gate.
- 실행 lease·프로세스 실제 정지 확인·자동 crash recovery. claimed 작업을 임의 재실행하지 않는다.
- 역할별 context assembler, context epoch/delta base, 한 모델 턴 전체의 누적 토큰 예산.
- Provider prompt cache 제어·usage/cost 정규화·실제 비용 절감 측정.
- 학습 후보 채택, 전문 검색/FTS, 자동 문서 색인·보존 기한 정리, artifact 삭제/tombstone.
- 대형/바이너리 artifact, SSE push, 원격 호스트, 자동 호스트 설정 설치 및 플러그인 패키지.

현재 task version은 작업 상태 revision이다. artifact hash는 내용 revision이며 자동 review gate와는 별개다. 세션 ID는 두레박 등록 ID이고 호스트 native session ID와 매핑하지 않는다. 세션별 MCP 설정을 유지할 수 없는 호스트에서는 동일 identity 공유를 방지하는 별도 연결 방식이 필요하다.

## 검증 기록

2026-09-29 개발 환경: macOS, Node 26.8.1, npm 11.19.0. TypeScript 7.0.2, MCP SDK 1.30.1, Zod 4.6.5를 lockfile에 고정했다.

macOS Node 26.8.1과 Node 24.21.0에서 각각 전체 테스트 14개가 통과했다. 정적 타입 검사, 빌드, 저장소 패턴 검사, npm tarball 17개 파일 allowlist 검사와 독립 설치 CLI smoke가 통과했다. Linux CI는 구성했으나 원격 실행하지 않았다.

- 정적 타입 검사와 빌드.
- SQLite 재연결, idempotency, workspace 격리, token 회수, claim 경쟁·오래된 완료 거부.
- 실제 HTTP 인증·위조 인자 거부·중복 daemon·요청 크기 제한·세션 페이지·재시작.
- 독립 MCP 프로세스 두 개의 요청·답변·작업·결과·export; 실행 중 credential 교체에도 identity 고정.
- UTF-8 범위, 캐시 분리/삭제 후 원본 보존, 결정적 기록과 수동 편집 보호.
- 실제 npm tarball의 allowlist 검사; 별도 디렉터리에 설치한 배포본의 CLI 버전·서버·등록·인증된 메시지 전송/조회 smoke 통과.

실제 호스트 CLI 시험을 추가했다. 결과와 실패 원인은 [호스트 테스트](HOST-TESTING.md)와 docs/testing의 보고서를 따른다. UI 조작·native 세션 resume·자동 wake·OpenCode 시험은 수행하지 않았다. 일반 MCP 통합 결과를 모든 호스트 인증으로 표시하지 않는다.

후속 실제 환경 검증(2026-09-29): Codex CLI 실제 호출 3회로 cooperative 요청·검토·수정 제출을 완료하고 DB 증거 11개를 확인했다. Claude는 OAuth 만료로 cross-provider 검증이 막혔으며 OpenCode는 미설치다. 자동 회귀 테스트는 21개로 확장했다. 자세한 재현 명령은 HOST-TESTING.md를 따른다.

큐 정책 추가: normal 5초 배치 대기, 4단계 중요도, busy/paused, aging·장기 대기 보호, urgent quota, receipt 기반 확인, 재전달 한도, schema 1→2 이관. 상세 계약은 [QUEUE-POLICY.md](QUEUE-POLICY.md)를 따른다. 위 실제 Codex 보고서는 큐 변경 전 결과이며 새 큐에 대한 호스트 검증과 구분한다.

큐 변경 후 회귀 검증: Node 24.21.0·26.8.1 각각 30개 통과, 타입 검사·패키지 allowlist·설치 smoke·MCP lab 11개 증거 통과.

큐 적용 후 실제 Codex↔Codex 검증도 통과했다: 호스트 호출 3회, MCP 도구 호출 10개, DB 증거 11개, 약 61초. 일반 메시지는 호스트 밖에서 기다렸고 모델을 대기 polling에 사용하지 않았다. [비민감 결과 보고서](testing/2026-09-29-codex-queue-live.json)에 기록했다. 각 호출은 새 native 실행이며 자동 wake·native 세션 resume 또는 Claude/OpenCode 실연동 성공을 의미하지 않는다.

후속 경계 개선: JSON 이스케이프 확장을 고려한 원문·inbox 페이지 제한, 구버전 범위 캐시 분리, 본문 수신 중 권한 회수 시 처리 직전 재인증, 단일 트랜잭션의 만료 판정·ack를 적용했다. 재현 과정은 [경계 개선 기록](testing/2026-09-29-hardening.md)을 따른다.
