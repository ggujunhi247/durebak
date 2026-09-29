# 이종 에이전트 연결 조사 — 2026-09-30

## 목적과 조사 범위

Claude Code, Codex, OpenCode 세션이 서로 요청·검토·수정 결과를 주고받는 것이 두레박의 필수 목적이다. Codex끼리 성공한 시험은 그 일부만 증명한다. 이 문서는 공식 문서 및 프로젝트 자체 설명을 비교한 조사이며, 외부 제품의 기능을 직접 실행해 확인했다는 뜻은 아니다.

현재 코드에서 `Session.provider`와 `register --provider`는 모델 제공자가 아니라 실행 도구 종류를 나타낸다. `setup.ts`는 호스트별 MCP 설정을 생성하고 `host-lab.mjs`는 Codex/Claude 실행 분기를 직접 가진다. 공통 메시지 큐는 도구 종류와 무관하지만 통합된 실행 어댑터와 모든 이종 조합의 실연동 증거는 아직 없다.

‘헐디’의 정확한 프로젝트명은 확인되지 않았다. 이름과 용도가 가까운 Herdr, vladzima/herd 및 별개 프로젝트 NickGuAI/Herd를 비교 대상으로 선정했다. 동일 제품이라고 간주하지 않는다. 로컬 `orca` 실행 파일은 PATH에서 발견되지 않아 설치 버전의 실행 가이드는 조회하지 못했다. 아래 Orca 설명은 공개 저장소 main 문서 기준이다.

## 사례 비교

| 사례 | 1차 자료에서 확인한 접근 | 두레박에 적용할 판단 |
| --- | --- | --- |
| [Orca orchestration](https://github.com/stablyai/orca/blob/main/skill-guides/orchestration.md) | 작업·dispatch 식별자로 완료 권한을 확인하며, 저장된 메시지 전송 성공과 수신/수락을 구분한다. wake는 best-effort다. | message, delivery, attempt, result를 분리하고 오래된 실행의 완료 보고를 거절한다. |
| [Orca CLI](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/cli/reference.mdx) | 실행 중인 runtime에 CLI가 연결하고 terminal/worktree와 커서 기반 출력을 다룬다. | IDE를 필수 의존성으로 만들지 않고 실행 환경 연결을 별도 backend 후보로 둔다. |
| [Herdr](https://herdr.dev/) | 백그라운드 서버가 여러 도구의 터미널을 관리하고 pane에서 working/blocked/idle을 관측한다. | 눈에 보이는 기존 세션 연결의 참고 사례다. 화면 기반 상태는 근거와 신뢰도를 표시하고 작업 성공 판정과 분리한다. |
| [vladzima/herd](https://github.com/vladzima/herd) | Herdr 위의 coordinator/worker 스킬·스크립트. worker report 파일을 완료 근거로 취급한다. | 스킬은 얇게 유지하되 두레박은 인증된 attempt와 artifact hash까지 결합한다. 파일 존재만으로 완료시키지 않는다. |
| [NickGuAI/Herd](https://github.com/NickGuAI/Herd) | mission 상태·메모리·승인과 하위 harness/연결 인프라의 책임을 분리하는 meta-harness다. | 호스트가 바뀌어도 작업·산출물은 유지한다. 웹 control plane과 원격 운영까지 첫 범위에 넣지는 않는다. |
| [acpx](https://github.com/openclaw/acpx), [sessions](https://github.com/openclaw/acpx/blob/main/docs/sessions.md) | ACP 에이전트의 구조화된 실행, 저장된 세션 및 명시적인 재개를 제공한다. 이름·명령·작업 디렉터리가 세션 선택에 관여한다. | 실행 backend 재사용 후보다. 두레박 session ID와 별도 저장하고 이중 소유·이중 큐를 방지한다. |

위 판단은 두레박의 설계 제안이다. 외부 코드를 복사하거나 의존성을 설치하지 않았다. 재사용은 릴리스/commit 고정, 라이선스 및 동일 계약 시험을 거친 뒤 결정한다.

## 공식 연결 면의 차이

| 도구/규약 | 확인한 공식 인터페이스 | 설계상 의미 |
| --- | --- | --- |
| [Codex App Server](https://learn.chatgpt.com/docs/app-server) | thread/start, thread/resume, turn/start, turn/steer 및 이벤트 | thread와 turn을 별도로 매핑한다. 시작 응답을 실행 완료로 보지 않는다. 임의의 열린 앱 세션에 접근할 수 있다고 추정하지 않는다. |
| [Claude Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions) | query의 session ID, resume, fork | 재개와 새 세션/분기를 구분한다. 최신 문서의 재개 동작을 설치된 구버전에 그대로 적용하지 않는다. |
| [OpenCode server](https://opencode.ai/docs/server/), [SDK](https://opencode.ai/docs/sdk/) | session, abort, SSE, prompt_async; provider/model 정보 별도 | HTTP 요청 접수와 실제 턴 완료를 분리한다. 도구와 모델 제공자가 서로 다른 축임이 드러난다. |
| [ACP initialization](https://agentclientprotocol.com/protocol/v1/initialization), [prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn) | capability 협상, session/prompt, session/update 및 취소 | 선언되지 않은 capability는 지원으로 추정하지 않는다. MCP 연결과 ACP 실행 제어를 혼용하지 않는다. |

MCP는 현재 두레박 도구에 접근하는 연결이다. 이 연결만으로 모델을 실행하거나 쉬는 호스트를 깨우는 기능이 생기지 않는다. ACP/native SDK는 실행 제어 후보이며, 메시징/작업 정책의 소유자는 두레박으로 유지한다.

## 세 가지 접근과 선택

1. **도구별 native API만 사용**: 의미와 오류 정보를 잘 보존하지만 각 도구의 변화에 대응해야 한다.
2. **ACP 하나로 모두 통일**: 연결 코드를 줄일 가능성이 있지만 bridge 버전·권한·재개 지원 차이는 남는다. 기존 활성 세션 attach가 자동 해결되지는 않는다.
3. **공통 계약 + 교체 가능한 native/ACP backend**: 공통 정책은 하나로 유지하고 각 backend를 같은 시험으로 평가한다. 계약과 검증표 유지 비용이 생긴다.

권장안은 3번이다. 기존 cooperative MCP를 기본으로 보존하고, managed 실행은 native와 ACP를 좁은 실험으로 비교한다. 검증 전 특정 backend를 모든 도구의 기본값으로 지정하지 않는다.

상세 계약은 [이종 세션 어댑터 설계](superpowers/specs/2026-09-30-heterogeneous-adapters-design.md)에 정리했다.
