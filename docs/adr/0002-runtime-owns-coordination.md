# ADR 0002: 협업 상태와 실행 소유권은 두레박이 소유한다

- 날짜: 2026-09-30
- 상태: Accepted — 메시징은 구현됨, 실행 소유권 확장은 예정
- 근거: [이종 어댑터 설계](../superpowers/specs/2026-09-30-heterogeneous-adapters-design.md)

## 배경

도구마다 실행·취소·재개 의미가 다르다. 메시지 전송 성공, 터미널 idle, 프로세스 exit 0은 결과 검증 완료를 의미하지 않는다. backend에도 큐가 있으면 중복 실행과 복구 판단이 복잡해진다.

## 결정

우선순위·batching·TTL·중복 억제·작업·artifact는 runtime의 공통 계약이다. 메시지 delivery/ack와 task attempt/완료는 분리한다. 실행 backend에는 한 세션당 활성 입력 하나만 제출한다.

관리 실행은 native session에 대해 단일 owner/epoch를 확인한다. lease 만료만으로 다른 프로세스의 종료를 추정하지 않는다. 제출 후 응답이 유실되면 reconcile하고, 결과를 모르면 unknown_outcome으로 유지한다. 오래된 attempt의 결과와 replay 이벤트는 새 작업을 만들지 않는다.

스킬은 협업 절차를 안내하고, 플러그인은 연결을 제공한다. 둘 다 영속 상태의 기준이 아니다. 모델이 반복 호출하며 기다리는 대신 runtime의 timer/event를 사용하도록 후속 구현한다.

## 대안과 비용

각 backend에 정책을 위임하면 구현은 빨라지지만 도구마다 전달 규칙과 재시도 의미가 달라진다. 공통 상태 머신을 유지하는 대신 mapping·장애 시험 비용이 생긴다. 외부 부작용의 exactly-once는 보장하지 않는다.

## 검증

접수 후 연결 단절, 승인 대기, 취소 요청 후 종료 미확인, 중복 완료, 오래된 owner, replay를 시험한다. 외부 writer를 배제할 수 없는 기존 세션은 자동 입력을 허용하지 않는다.
