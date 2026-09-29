# 실제 호스트 테스트 환경

두레박 런타임·MCP bridge를 임시 비공개 디렉터리에서 띄우고, 두 개의 credential로 협업을 재현한다. 기존 전역 MCP 설정을 수정하지 않는다. 실행 후 credential·DB·임시 작업 공간은 삭제하고 판정·버전·시간·제공된 usage만 보고서에 남긴다.

## 실행

```sh
npm ci
npm run lab
npm run lab:live
npm run lab:live -- --reviewer codex
```

`lab`은 공식 MCP SDK 프로세스 둘로 동작을 검증한다. 모델을 호출하지 않는다. `lab:live`는 기본으로 로그인된 `codex`와 `claude`를 실제로 세 번 호출하며 계정 사용량이 발생한다. `--reviewer codex`로 서로 다른 Codex 참여자끼리 시험할 수도 있다. OpenCode는 이 하네스에서 실행하지 않는다. 실제 호스트 시험은 일반 `npm test`나 CI에서 자동으로 호출하지 않는다.

보고서를 보존하려면:

```sh
npm run lab:live -- --report /private/output/new-report.json --timeout-ms 90000
```

보고서 경로를 호스트 실행 전에 0600 권한으로 독점 확보한다. 기존 파일 또는 존재하지 않는 상위 디렉터리는 모델 호출 전에 거부한다. 출력 디렉터리는 미리 만들어야 한다. 실행 중에는 status=running, complete=false인 임시 상태가 표시되며 완료 시 결과로 교체된다. 강제 종료 후 이 상태가 남으면 미완료 실행으로 취급한다. 각 호스트 호출은 기본 90초, 최대 180초이며 출력은 2 MiB로 제한된다. Claude에는 호출당 1달러 API budget 옵션도 전달한다. 구독 사용량·현금 청구액·이 값은 같지 않으며 Codex의 달러 한도를 보장하지 않는다. 사용량을 제공하지 않으면 unknown/null로 남긴다.

## 시나리오와 성공 판정

1. Codex worker가 `6*7`의 잘못된 후보 `41`을 reviewer에게 전송한다.
2. 선택한 reviewer(기본 Claude)가 receive로 받고 id·receipt로 ack한 뒤 원 요청에 연결된 수정 답변 `42`를 보낸다.
3. Codex worker가 답변을 읽고 작업을 claim한 뒤 수정 결과 artifact를 제출한다.
4. 하네스가 저장소에서 실제 발신자·수신자, 본문 nonce, 읽음 상태, reply 연결, task owner·완료 상태, artifact hash·내용을 확인한다.
5. 동일 원문 재조회에서 파생 캐시 적중, 문서 렌더링의 모델 호출 0회도 확인한다.

모델이 “성공했다”고 말하거나 종료 코드 0을 반환하는 것만으로 통과시키지 않는다. 모델에는 shell·파일 수정·브라우저·다른 MCP를 허용하지 않고 해당 단계에 필요한 두레박 도구만 제공한다. 제공되는 내용은 생성한 합성 fixture뿐이다.

## 세션 경계

호스트 호출마다 새 native 세션을 사용한다. 첫 번째와 세 번째 Codex 호출은 같은 두레박 credential을 사용하지만 native 대화 세션이 이어지는 것은 아니다. 따라서 이 시험은 서로 다른 실제 호스트에서 cooperative 통신이 가능한지 확인하며, native 세션 resume·자동 wake·동시 실행·워크플로 스케줄러 검증은 별도다.

## 문제 구분

- CLI 미설치 또는 로그인 필요: 환경 준비 실패.
- 서버 연결/도구 호출 오류: 호스트와 MCP 연결 실패.
- 호스트 종료 0이나 DB 증거 없음: 시나리오 실패.
- timeout 또는 출력 한도: 해당 프로세스 그룹 종료 후 실패 처리.
- 사용자 취소: 실행 중인 호스트 그룹을 정리하고 이후 사전 점검·모델 프로세스는 시작하지 않는다. 보고서에는 cancelled를 기록한다.
- 정리 실패: 보고서에 cleanup_failed를 기록하며 성공으로 표시하지 않는다.
- OS sandbox가 keychain/network 접근을 막으면 로그인 여부가 실제와 다르게 보일 수 있다. 비밀정보를 복사해 우회하지 않고 해당 실행 환경의 권한으로 재확인한다.

설정 근거: [Codex MCP 공식 문서](https://developers.openai.com/codex/mcp/), [Claude Code CLI 공식 문서](https://code.claude.com/docs/en/cli-reference). 실제 사용할 수 있는 옵션은 설치된 CLI help와 함께 확인했다.

## 발견한 호스트 차이

Codex CLI 0.146.0의 비대화형 실행에서 MCP approval 기본값/auto만 지정하면 도구 호출이 취소되는 것을 관측했다. 이 하네스는 임시 `durebak` 서버의 `enabled_tools`로 해당 단계의 도구만 노출하고 `default_tools_approval_mode=approve`를 명시한다. 전역 approval 설정이나 shell sandbox를 해제하지 않는다.

Claude의 `auth status`에 loggedIn=true가 표시되어도 실제 API에서 OAuth 만료로 거부될 수 있다. stream-json의 authentication_failed 이벤트가 나오면 추가 재시도를 기다리지 않고 프로세스 그룹을 종료해 보고한다. 이때 사용자가 `claude auth login`으로 재로그인해야 한다.

보고서의 usage는 해당 실행의 공급자 원본 수치다. 앞선 진단·재실행 사용량을 합산한 총비용이 아니며 cache-read 값을 input total에 다시 더하지 않는다. 도구 오류 후 회복된 경우 경고를 보존하고 최종 저장 증거가 모두 충족된 경우에만 통과한다.

## 2026-09-29 실제 실행 결과

- macOS / Node 26.8.1 / Codex CLI 0.146.0: `--reviewer codex`로 실제 모델 호출 3회, MCP 도구 호출 10회, 저장 증거 검사 11개 통과. 마지막 실행에서는 도구 오류·경고가 없었다. 약 57초 소요.
- Claude Code 2.1.87: 로컬 로그인 기록은 감지됐으나 API OAuth 토큰 만료(401), refresh 실패로 cross-provider 완료 검증은 막혔다. MCP 없는 최소 호출에서도 같은 오류를 확인했다.
- OpenCode: 현재 환경 미설치, 실행하지 않았다.
- 자동 회귀 테스트와 모델 없는 `lab`은 호스트 인증 없이 실행 가능하다.

[Codex 실제 실행 보고서](testing/2026-09-29-codex-live.json) · [Claude 인증 차단 근거](testing/2026-09-29-claude-blocker.json)

## 큐 정책 적용 이후

호스트 실험은 기본 normal 메시지를 보내고 호스트 밖의 queue_status 대기로 전달 가능 시점을 확인한다. 모델은 receive로 메시지를 가져온 직후 반환된 id·receipt로 ack한다. 긴급 표시로 테스트 대기를 우회하지 않는다. 기존 docs/testing 보고서는 큐 정책 도입 전 실험 기록이다.

큐 적용 후 실제 Codex↔Codex 검증도 통과했다: 호스트 호출 3회, MCP 도구 호출 10개, DB 증거 11개, 약 61초. 일반 메시지는 호스트 밖에서 기다렸고 모델을 대기 polling에 사용하지 않았다. [비민감 결과 보고서](testing/2026-09-29-codex-queue-live.json)에 기록했다. 각 호출은 새 native 실행이며 자동 wake·native 세션 resume 또는 Claude/OpenCode 실연동 성공을 의미하지 않는다.

## 연결 흐름

작업자와 검토자는 서로 다른 두레박 credential을 받는다. 각 Codex 실행에는 자기 credential을 사용하는 stdio MCP bridge만 연결한다. `send`는 인증된 발신자와 지정 수신자에 대해 SQLite 큐에 저장하고, 호스트 밖의 대기가 끝난 뒤 상대 실행의 `receive`가 메시지를 가져간다. `ack`는 해당 전달 receipt로 확인하며 답변은 `replyTo`로 원 요청에 연결한다. 마지막 작업자 실행은 같은 두레박 identity로 답변을 받아 결과 artifact를 제출한다. 하네스는 대화 본문을 직접 실행 간 복사하는 대신 DB의 발신자·수신자·답변 연결을 검사한다. 합성 테스트의 기대 답변은 프롬프트에 주어지므로 이 시험은 독립 추론 능력보다 실제 통신 경로를 검증한다.

## 병합 전 최종 실연동

안정성 개선을 포함한 최신 코드로 Codex CLI 0.146.0을 3회 실행했다. 두레박 도구 10개 호출과 DB 증거 11개 모두 통과했고 경고는 없었다. 약 71초가 걸렸다. [최종 실연동 보고서](testing/2026-09-29-codex-final-live.json)를 참고한다. 이 검증은 합성 메시지의 실제 전달 경로를 확인하며 같은 native 대화의 resume 검증은 아니다.
