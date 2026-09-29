# ADR 0001: Harness, backend, model을 분리한다

- 날짜: 2026-09-30
- 상태: Accepted — 구현 예정
- 근거: [이종 어댑터 설계](../superpowers/specs/2026-09-30-heterogeneous-adapters-design.md), [사례 조사](../HETEROGENEOUS-AGENTS.md)

## 배경

현재 provider는 Claude/Codex/OpenCode 실행 도구를 뜻한다. OpenCode에서 추론 제공자나 모델을 바꾸는 경우 이 이름만으로는 연결 방식과 모델 선택을 표현할 수 없다.

## 결정

harness는 실행 도구, backend는 MCP/native/ACP 연결 방식, modelProvider/model은 확인된 추론 설정으로 구분한다. 모델별로 실행 어댑터를 복제하지 않는다. host는 머신이다. 기존 register --provider와 setup --host는 호환 별칭으로 유지하며 새 이름과 충돌하면 거절한다. 기존 DB provider를 modelProvider로 해석하지 않는다.

설정 생성과 진단을 담당하는 연결 어댑터를 먼저 분리하고, start/attach/resume/submit 등을 담당하는 실행 어댑터는 별도 단계로 구현한다. 검증하지 않은 기능은 unknown/unsupported로 남긴다.

## 대안과 비용

native API만 사용하면 의미를 잘 보존하지만 도구별 유지보수 비용이 크다. ACP 하나로 통일하면 코드 재사용 여지는 있지만 모든 도구의 승인·재개·기존 세션 연결을 보장하지 않는다. 공통 계약 아래 native/ACP를 교체 가능하게 두되 버전별 계약 시험을 유지하는 비용을 받아들인다.

## 검증

기존 CLI/credential 호환, 별칭 충돌, 동일 harness의 다른 모델, 미확인 capability 거절, 6방향 실제 이종 통신을 각각 확인한다. 공식 문서의 기능 설명은 실연동 성공 증거가 아니다.
