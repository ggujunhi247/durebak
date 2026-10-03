# 구현 현황 — 0.1.0-alpha.3

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

## 검증 범위

자동 테스트는 SQLite 저장·복구, 권한과 workspace 경계, 작업 경쟁, 큐 정책, HTTP·MCP 통신 및 기록 내보내기를 확인합니다. Linux·macOS CI에서 타입 검사, 테스트와 패키지 설치 검증을 실행합니다. 최신 결과는 [GitHub Actions](https://github.com/ggujunhi247/durebak/actions)를 확인하세요.

실제 모델을 통한 Codex↔Codex cooperative 통신은 확인했습니다. Claude Code·OpenCode와의 이종 실통신, native resume·자동 wake는 검증된 지원에 포함되지 않습니다. 재현 절차는 [호스트 테스트](HOST-TESTING.md), 지원 범위는 [호환성](COMPATIBILITY.md)을 따릅니다.

## alpha.3 연결 관측과 기능 근거

추가 후보를 비활성 상태로 보여주는 harnesses catalog, epoch별 MCP bridge 접촉과 별도 CLI 활동, 읽기 전용 session_health 및 doctor 검사별 안내를 추가했다. schema 3→4 migration은 원본 credential·message·task·artifact·delivery audit/cursor를 보존한다. 설정 출력은 config_fragment/renderer_tested이며 native_session_isolation은 unverified다. 실제 신규 host·native 자동 wake는 지원 완료로 표시하지 않는다.

2026-10-04 alpha.3 로컬 검증: 전체 시험 94개, 타입 검사, 저장소/비밀정보 검사, 53개 파일 tarball allowlist 및 독립 설치 smoke 통과. MCP 초기 협업 지침과 기본 로컬 저장 경로 기능을 보존했다. 실제 코딩 host 실연동 결과와 별개다.
