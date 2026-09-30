# 메시지 큐 정책 v1

메시지 저장과 수신자에게 전달하는 시점을 분리한다. 모델 실행 스케줄러와 달리 이 큐는 Cooperative 세션이 `receive`로 가져갈 때 정책에 맞는 묶음을 선택한다. 자동 wake나 실행 중인 호스트 중단을 의미하지 않는다.

## 기본 규칙

| 등급 | 최소 대기 | 의도 |
|---|---:|---|
| urgent | 0초 | 즉시 검토가 필요한 위험·차단, 사유 필수 |
| high | 1초 | 다른 작업의 진행을 막는 요청 |
| normal | 5초 | 일반 요청·답변을 모아서 전달 |
| low | 30초 | 참고·진행 상황·후속 제안 |

발신자가 추가 delayMs를 지정해도 최소 대기는 단축되지 않는다. 수신자는 available, busy, paused 상태를 설정한다. busy일 때는 urgent만 다음 receive에서 받을 수 있고, paused는 모든 전달을 막는다. 이 상태는 명시적으로 변경할 때까지 유지하며 재시작해도 보존한다. 긴급 표시가 host 실행 중단 권한을 주지 않는다.

기본 receive 묶음은 5개, 최대 10개다. 같은 점수에서는 최초 저장 seq가 빠른 것을 우선한다. 일반 메시지는 대기 시간 30초마다 순위를 높이되 urgent보다 높이지 않는다. 120초 이상 준비된 상태로 기다린 일반 메시지가 있으면 묶음의 첫 자리는 가장 오래 기다린 메시지에 할당한다. 따라서 긴급 요청이 이어져도 일반 메시지가 영원히 밀리지 않는다. 이 규칙도 busy/paused를 우회하지 않는다.

urgent는 발신 세션당 최근 60초에 최대 3개이며 초과 요청은 명시적으로 거부한다. 동일 idempotency key 재시도는 새 메시지나 quota 사용을 만들지 않는다. 큐 용량은 수신자당 queued+in_flight 합계 100개다.

## 상태와 확인

`queued → in_flight → read`. receive는 DB transaction 안에서 최대 30초 lease와 매번 새로운 receipt를 발급한다. 같은 메시지가 두 수신 호출에서 동시에 할당되지 않는다. ack에는 id와 receipt가 필요하며, 읽음 확인은 task 완료와 별개다. stale receipt는 거부한다.

lease 만료 시점을 기준으로 재전달까지 1초부터 지수 backoff(최대 60초)를 적용한다. 최대 5번 전달 후 확인되지 않으면 dead_letter로 분리한다. lease 만료는 호스트 종료의 증거가 아니며 모델을 자동 재실행하지 않는다. 모든 처리 결과에는 at-least-once 전달 가능성을 고려해야 한다.

기본 TTL은 24시간이며 ttlMs로 줄일 수 있다. 만료된 메시지는 expired가 되어 새로 전달하지 않는다. 만료나 dead_letter는 조용히 삭제하지 않고 원문과 상태를 남긴다. 재전송은 원인을 확인한 뒤 새 key로 명시적으로 보낸다.

## 조회와 대기

receive에는 seq cursor를 사용하지 않는다. 늦게 준비된 낮은 seq를 높은 seq cursor 때문에 놓치지 않도록 한다. 응답의 retry_after_ms는 다음 가능한 조회 시점에 대한 힌트이며 자동 polling이나 모델 재호출 명령이 아니다. queue_status는 본문 없는 개수·상태·정책을 제공한다.

inbox는 이미 전달된 메시지의 감사용 기록이다. queued 원문은 수신자에게 노출하지 않는다. message_read도 최초 전달 전에는 수신자에게 원문을 주지 않는다. 발신자는 자기 원문과 message_status로 대기 사유를 확인할 수 있다.

## 복구와 호환

SQLite schema 1을 2로 원자적으로 이관한다. 기존 read는 유지하고 기존 sent는 즉시 준비된 queued로 옮긴다. 기존 unread에는 새 TTL을 소급 적용하지 않는다. 새 메시지는 기본 normal 지연을 따른다. 과거 이벤트는 재생해도 receive나 모델 실행을 일으키지 않는다.

이 변경은 alpha API의 전달 계약 변경이다. 클라이언트는 send→inbox 대신 send→receive→ack(id,receipt)를 사용해야 한다. 일반 메시지를 계속 urgent로 바꿔 우회하지 않고, 호스트 밖의 대기 루프가 retry_after_ms를 이용한다. Provider 모델의 토큰 비용을 쓰지 않는 대기가 기본이다.

## 감사 커서 v2 (DB schema 3)

inbox의 after/next는 최초 전달 순서 커서다. 메시지 seq는 저장 순서이므로 after로 사용하지 않는다. 응답 cursor_version=2를 확인하고 next를 그대로 저장한다. 기존 seq 기반 커서는 업그레이드 시 0으로 초기화하고 message id로 중복을 제거한다. 재전달은 최초 전달 기록을 중복 생성하지 않는다. 기존 DB의 전달 기록은 delivered_at·seq 순서로 이관하며 pending 메시지는 실제 전달 시 기록에 추가한다. 이전 DB에 같은 시각으로 기록된 전달의 정확한 내부 순서는 복원하지 못하므로 seq를 동률 기준으로 사용한다.
