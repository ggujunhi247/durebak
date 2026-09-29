# 응답·권한·확인 경계 개선

## 재현과 수정

- 제어문자 위주의 4 KiB 원문은 JSON에서 16 KiB를 넘어 artifact_read/message_read가 HTTP 413을 반환했다. JSON 내용 예산 12,000 bytes를 적용하고 UTF-8 경계와 next를 보존한다. 범위 캐시는 range-v2로 분리해 이전의 큰 페이지를 재사용하지 않는다.
- 제어문자 preview 20개를 inbox로 조회하면 HTTP 413이었다. 응답 예산에 맞춰 items를 줄이고 실제 반환된 마지막 seq와 has_more를 계산한다. 재조회로 20개 모두 누락 없이 확인했다.
- HTTP 100-continue로 본문 수신을 지연한 뒤 발신 credential을 회수해도 기존 요청은 성공했다. 본문 수신 뒤 실제 처리 직전에 재인증해 401을 반환하고 큐가 변경되지 않는 것을 확인했다.
- ack의 만료 정리와 읽음 저장 사이 COMMIT 이후에 30초 지연을 주입하면 유효기간이 지난 확인을 저장했다. 실제 SQLite trigger로 쓰기 시점을 관찰해 재현했다. 하나의 트랜잭션에서 판정·저장하며, 거부 오류는 정리 결과를 커밋한 뒤 반환한다. 유효성은 이 트랜잭션의 판정 시점 기준이다.

## 재현 테스트

- tests/runtime.test.ts: escaped message/artifact paging, audit inbox pagination, slow-body revocation.
- tests/records.test.ts: legacy cached page bypass and original hash preservation.
- tests/queue.test.ts: transaction-gap ack expiry and existing retry/expiry cases.

이번 검증은 실제 HTTP·SQLite·독립 MCP 프로세스를 사용하며 Provider 모델 호출 성공을 새로 주장하지 않는다. 기존 Codex 실험은 별도 보고서에 보존한다.

## 최종 검증 결과

Node 26.8.1과 Node 24.21.0에서 각각 전체 35개 테스트 통과. 타입 검사, 패키지 17개 파일 allowlist, 저장소 위생 검사, git diff 공백 검사 통과. 독립 MCP 프로세스의 전송·수신·확인·결과 제출은 전체 테스트에서 다시 확인했다. 별도 코드 리뷰에서 마지막 수정에 대한 차단 이슈가 없음을 확인했다.
