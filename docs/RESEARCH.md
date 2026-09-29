# 두레박 유사 도구·표준 조사와 설계 보충

- 조사일: 2026-09-29
- 대상 스펙: [제품 스펙 v0.3.0](superpowers/specs/2026-09-29-durebak-design.md)
- 범위: 같은 컴퓨터의 기존 코딩 에이전트 세션 협업, 반복 개선, 복구, 공개 배포.
- 방법: 프로젝트가 직접 제공한 README·사용 가이드와 공식 프로토콜 문서를 열어 비교했다. 설치·벤치마크·소스 코드 전체 감사는 수행하지 않았다.
- 근거 등급: **문서 확인**, **두레박 설계 판단**, **실연동 검증 필요**를 구분한다. 기능 소개를 성능·안정성 보장으로 해석하지 않는다.

## 1. 조사 결론

두레박의 구성 요소와 겹치는 구현은 이미 있다. 메시징은 Agent Mail 계열과 Agent Relay, 상태를 유지하는 실행 연결은 acpx, 작업 의존성과 영속 기록은 Beads, 결과 검증 루프는 tedevH/Relay가 가까운 비교 대상이다.

두레박은 **기존 세션의 참여 + 명시적인 실행 소유권 + 동일 결과 버전에 대한 검토·검증 + 복구 가능한 개선 반복**을 하나의 로컬 사용 경험으로 묶는 데 집중한다. 이는 목표로 삼는 제품 방향이지 경쟁 도구에 해당 기능이 없다는 단정이나 독창성 증명이 아니다.

공통 런타임을 유지하되 실행 계층은 재사용을 우선 평가한다. acpx/ACP 경로를 호환성 검증 단계에 추가하고, 직접 어댑터와 동일한 계약 시험으로 비교한다. 원격 서비스, 전체 세션 기록 공유, 다중 검토자 등은 이번 보충으로 필수 범위에 추가하지 않는다.

## 2. 유사 도구 비교

| 대상 | 문서에서 확인한 기능 | 두레박에 반영할 판단 | 도입 전 확인 |
|---|---|---|---|
| [AgentWorkforce/relay](https://github.com/AgentWorkforce/relay) | 채널·DM·스레드·실시간 이벤트, 세션 공유, 결정적 검사와 필수 단계를 가진 Flows | 소통 기능과 실행 규칙의 구분. 검증 gate는 런타임이 집행 | 필요한 기능의 로컬 실행 범위, 서비스 의존성, 어댑터별 성숙도 |
| [osteele/agent-mail](https://github.com/osteele/agent-mail) | 로컬 영속 spool, MCP 우편함, Claude channel push, 전달 단계 구분, native 메시지 감사 | 저장·전달·읽음의 분리, native 감사의 재전송 금지 | 기존 세션 identity, 두레박 저장 모델과 연결 가능성 |
| [Dicklesworthstone/mcp_agent_mail](https://github.com/Dicklesworthstone/mcp_agent_mail) | 에이전트 등록, threaded messaging, 우편함 확인, advisory 파일 예약 | 파일 예약과 작업 소유권을 분리하고 요청·답변 관계를 유지 | 실제 버전의 데이터 모델·설치 의존성·라이선스 |
| [openclaw/acpx](https://github.com/openclaw/acpx) | ACP 상태 유지 세션, 후속 prompt 대기열, 구조화된 출력, runtime/flows 임베딩 | 공통 실행 backend 후보. 이중 대기열과 이중 세션 소유권 방지 | 대상 Provider 세 가지의 인증·권한·취소·재개 계약 |
| [gastownhall/beads](https://github.com/gastownhall/beads) | 지속적인 작업 그래프, ready 작업 탐색, 원자적 claim, 기억 관리 | 작업 수락을 원자적 claim으로 정의하고 대화 기록과 작업 상태 분리 | 외부 issue tracker로 연동할 가치; v0.1 필수 DB로 채택하지 않음 |
| [tedevH/Relay](https://github.com/tedevH/Relay) | 로컬 Claude/Codex 라우팅, 프로젝트 맥락, verify/retry 루프, 결과 카드 | 결과 요약과 다음 행동을 구조화하고 개선 효과를 측정 | 세션 간 직접 소통과 실행기 경계; OpenCode 경로는 미확인 |
| [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) | 여러 Claude 세션 협업. 문서에 재개·작업 상태·종료 제약 명시 | live 상태와 복구 상태를 분리하고 native 경로와의 중복 방지 | 특정 버전에서의 실제 동작. 이종 Provider 통합의 보장으로 사용하지 않음 |

이름이 비슷한 osteele/agent-mail과 Dicklesworthstone/mcp_agent_mail은 서로 다른 프로젝트다. AgentWorkforce/relay와 tedevH/Relay도 구분한다. 위 표는 확인한 기능만 요약하며 확인하지 않은 항목을 미지원으로 판정하지 않는다.

Beads는 확인 시점의 README에서 Dolt를 기반 저장소로 설명한다. 과거 글의 JSONL 구조를 현재 주 저장소라고 가정하면 안 된다. 릴리스 평가에서는 문서와 실제 버전을 함께 고정해야 한다.

## 3. 표준과 영속 실행 참고

| 대상 | 확인한 사실 | 두레박의 적용 |
|---|---|---|
| [ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup) | loadSession capability 확인이 필요하고 load 시 과거 conversation update가 재생됨 | replay 이벤트가 새 작업·답변으로 처리되지 않도록 origin과 replay 경계 필수 |
| [ACP prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn) | prompt/update/종료 및 취소를 갖는 세션 실행 프로토콜 | Provider 기능 협상과 실행 상태 정규화의 후보 |
| [MCP Tasks 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks) | 실험적 장기 실행 상태·결과 조회. 상태 알림 수신에 의존하면 안 됨 | 기본 경로는 request ID와 조회/짧은 wait. Tasks 매핑은 후속 협상 기능 |
| [A2A task lifecycle](https://a2a-protocol.org/latest/topics/life-of-a-task/) | terminal task는 재시작하지 않고 같은 context의 새 task로 개선 요청 연결 | 두레박도 종료 작업을 되살리지 않고 새 작업/라운드로 연결 |
| [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence) | checkpoint와 장기 store를 구분하며 메모리 저장은 재시작 후 유지되지 않음 | workflow checkpoint와 재사용 learning을 다른 수명으로 관리; 라이브러리 도입은 별도 판단 |

ACP는 **Agent Client Protocol**을 뜻한다. 이름이 비슷한 다른 agent communication 규약과 혼용하지 않는다. MCP·ACP·A2A는 서로 다른 경계의 프로토콜이므로 하나를 지원한다고 다른 기능이 자동 제공되는 것은 아니다.

## 4. 재사용 결정

| 선택 | 현 단계 결정 | 근거 |
|---|---|---|
| 두레박 runtime과 상태 모델 | 유지 | workflow 권한·검증·복구·사용자 통제의 기준을 한 곳에 둠 |
| acpx/ACP 실행 연결 | **검증 우선 후보** | 문서상 상태 유지와 queue/runtime 기능을 제공하여 중복 구현을 줄일 여지가 있음 |
| Provider 직접 SDK/API | 기본 비교 경로 유지 | 승인·usage·세션 제어의 기능 차이를 확인하는 기준 |
| Agent Mail/Relay 메시징 전체 내장 | 채택 보류 | 상태 원장 두 개와 identity·권한·재시도 책임 중복을 피해야 함 |
| Beads | 후속 issue 연동 후보 | v0.1 작업 상태의 기준은 두레박 DB로 유지 |
| LangGraph | 원칙 참고 | 현재 범위는 작은 결정적 상태 머신으로 시작; 필수 의존성 증가 근거 부족 |
| MCP Tasks/A2A gateway | 후속 선택 기능 | host 지원 차이와 첫 버전의 로컬 범위 고려 |

재사용 후보는 동일한 세션 유지, 단일 실행 소유권, 승인 대기, 취소, 불확실한 실행 복구, 재생 이벤트 분리, 로컬 설치와 버전 고정 시험을 통과해야 한다. 코드 도입 전 LICENSE·NOTICE·전이 의존성은 고정한 tag/commit에서 확인한다. 이번 조사에서 라이선스 적합성은 판정하지 않았다.

## 5. 스펙에 반영한 보충

| 조사로 확인한 설계 쟁점 | 보충 위치 | 검증 기준 |
|---|---|---|
| 표시 이름만으로 세션을 식별하면 충돌 | §5.4 identity와 binding | AC-19 |
| 기존 backend와 이중 실행 소유권 | §4.1 backend 계약 | AC-20 |
| ACP 재개 history와 native 감사 중복 | §7.3 provenance/replay | AC-21~22 |
| 작업 중복 수락·만료 lease 재사용 | §8.1 원자적 claim | AC-23 |
| rate limit·인증·sleep 후 불명확한 재개 | §8.2 중단 사유와 복구 | AC-24 |
| 기억과 작업 결과가 혼동됨 | §9.6 checkpoint/context | AC-25 |
| 실제 실행 중인데 cancelled만 보임 | §8.3 stop 상태 | AC-26 |
| 기준 변경 후 과거 통과 근거 재사용 | §9.6 policy/gate 버전 | AC-27 |
| 반복 대화 증가가 개선으로 오인됨 | §9.7 outcome/evaluation | AC-28 |

FR-15~20과 AC-19~28은 원래의 로컬 협업 목표를 명확하게 하는 요구사항이다. 원격 지원이나 새로운 Provider 추가를 의미하지 않는다.

## 6. 남은 실험

1. acpx를 사용한 실행 경로와 직접 API 경로를 같은 세 Provider·OS에서 비교한다. 세션 유지·소유권·취소·권한을 먼저 본다.
2. 최신 문서의 기능이 실제 설치된 버전에도 있는지 확인한다. 기능 이름만 보고 Attached 지원을 선언하지 않는다.
3. daemon과 모델 실행을 각각 끊어 durable queue·replay·unknown attempt를 확인한다.
4. 같은 fixture와 예산으로 단일 세션, 메시징만 사용한 협업, 검증 루프 협업을 비교한다. 개선되지 않거나 비용만 늘어난 결과도 기록한다.

이 실험들은 아직 수행하지 않았다. 이번 변경은 조사와 스펙 보충이다.

## 7. 근거와 재현 범위

모든 비교 링크는 프로젝트 자체 문서 또는 공식 표준이다. GitHub 문서는 조사 시점의 main과 공식 웹 문서를 읽었으며 불변 commit snapshot을 확보하지 않았다. 버전별 채택 판단에는 tag/commit, Provider 버전, OS, 테스트 로그를 추가해야 한다. 검색 결과 요약이나 커뮤니티 게시글만을 기능 판정 근거로 사용하지 않았다.

추가로 읽은 실행 계약: [acpx CLI](https://github.com/openclaw/acpx/blob/main/docs/CLI.md), [acpx sessions](https://github.com/openclaw/acpx/blob/main/docs/sessions.md). 기존 Provider 근거는 제품 스펙의 S1~S8을 유지한다.

## 2026-09-30 이종 세션 후속 조사

[Orca·Herdr·Herd 및 native/ACP 비교](HETEROGENEOUS-AGENTS.md)와 [구체화한 어댑터 계약](superpowers/specs/2026-09-30-heterogeneous-adapters-design.md)을 추가했다. 도구/모델 제공자 구분, 검증된 capability, 이중 실행 방지, 6방향 실제 호스트 수용 기준을 다룬다. 기존 실연동 성공 범위를 확장해 주장하지 않는다.
