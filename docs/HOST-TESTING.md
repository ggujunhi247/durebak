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

## 확인된 범위

Codex CLI 0.146.0의 Codex↔Codex 시험에서 호스트 호출 3회, MCP 도구 호출 10개와 DB 증거 검사 11개를 통과했습니다. 2026-10-01 재시험에서도 Codex가 요청을 보낸 뒤 Claude Code 모델 API가 `authentication_failed`로 중단됐습니다. `claude auth status`의 loggedIn=true만으로 실제 모델 호출 성공을 판단하지 않습니다. OpenCode는 실제 모델 시험 환경 미비로 이종 통신 성공을 주장하지 않습니다. 설치·파서 검증과 실제 모델 왕복을 구분합니다.

일반 메시지는 호스트 밖에서 큐의 전달 가능 시점을 기다립니다. 수신 모델은 `receive`의 id·receipt로 `ack`하며, 답변은 `replyTo`로 원 요청과 연결합니다. 모델을 대기 polling에 사용하거나 긴급 표시로 시험 대기를 우회하지 않습니다.

호스트 호출마다 새 native 실행을 사용합니다. 같은 두레박 credential 재사용은 native 대화 재개를 뜻하지 않습니다. 합성 기대 답변은 프롬프트에 주어지므로 독립 추론 능력이 아닌 실제 통신 경로를 검증합니다.
