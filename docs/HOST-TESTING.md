# 실제 호스트 테스트 환경

두레박 런타임·MCP bridge를 임시 비공개 디렉터리에서 띄우고, 두 개의 credential로 협업을 재현한다. 기존 전역 MCP 설정을 수정하지 않는다. 실행 후 credential·DB·임시 작업 공간은 삭제하고 판정·버전·시간·제공된 usage만 보고서에 남긴다.

## 실행

```sh
npm ci
npm run lab
npm run lab:live
npm run lab:live -- --reviewer codex
npm run lab:matrix -- --worker codex --reviewer opencode
npm run lab:matrix -- --live --worker codex --reviewer opencode --opencode-model PROVIDER/MODEL
npm run lab:matrix -- --worker codex --reviewer agy
```

`lab`은 공식 MCP SDK 프로세스 둘로 동작을 검증한다. `lab:live`는 기본으로 로그인된 `codex`와 `claude`를 실제로 세 번 호출하며 계정 사용량이 발생한다. `--reviewer codex`로 서로 다른 Codex 참여자끼리 시험할 수 있다. OpenCode는 명시적인 모델과 격리 프로필에서 접근할 수 있는 인증을 사용한다. 일반 `npm test`에는 모델 호출이 없다.

`lab:matrix`에 `--worker`와 `--reviewer`를 함께 주면 지정한 방향만 확인한다. `--live` 없이 실행하면 모델을 호출하지 않는다. 전체 매트릭스는 `agy`의 설치·버전을 후보 정보로 보고한다.

### Antigravity 리뷰어 시험

Linux 또는 macOS에서 로그인된 Codex CLI와 agy를 사용합니다. 아래 명령은 저장소에서 실행합니다.

1. **전용 홈 만들기.** 같은 셸에서 `agy_home`을 이후 단계에도 사용합니다. 로그인용 작업 디렉터리와 XDG 경로는 검증 대상 홈의 바깥에 둡니다.

   ```sh
   agy_trial=$(mktemp -d "${TMPDIR:-/tmp}/durebak-agy.XXXXXXXX")
   agy_trial=$(cd "$agy_trial" && pwd -P)
   agy_home="$agy_trial/home"
   mkdir -m 700 "$agy_home" "$agy_home/.gemini" "$agy_home/.gemini/antigravity-cli"
   mkdir -m 700 "$agy_trial/work" "$agy_trial/config" "$agy_trial/cache" "$agy_trial/data" "$agy_trial/state"
   ```

2. **전용 홈에서 로그인.** 아래 서브셸에서 agy를 띄웁니다. 로그인 화면이 나오면 공식 인증 절차를 마치고 agy를 종료합니다. 운영체제 키링에 로그인 상태가 있으면 인증 화면 없이 열릴 수 있습니다. [Antigravity CLI 인증](https://antigravity.google/docs/install?tab=cli)

   ```sh
   (
     cd "$agy_trial/work"
     HOME="$agy_home" \
       XDG_CONFIG_HOME="$agy_trial/config" XDG_CACHE_HOME="$agy_trial/cache" \
       XDG_DATA_HOME="$agy_trial/data" XDG_STATE_HOME="$agy_trial/state" \
       AGY_CLI_DISABLE_AUTO_UPDATE=true agy
   )
   ```

3. **모델 호출 전 설정 충돌 확인.** 로그인 과정에서 전용 홈에 `settings.json`이 생성됐다면 아래처럼 홈 바깥에 보관합니다. 이 경로는 시험 도구가 실행 중에 사용합니다. 별도의 MCP·플러그인·훅 설정을 가져온 경우 새 전용 홈으로 시작합니다.

   ```sh
   if [ -f "$agy_home/.gemini/antigravity-cli/settings.json" ]; then
     mv -i "$agy_home/.gemini/antigravity-cli/settings.json" "$agy_trial/login-settings.json"
   fi
   npm run build
   node --input-type=module - "$agy_home" <<'JS'
   import { validateAgyHome } from './scripts/lib/host-adapters/antigravity-cli.mjs';
   try {
     validateAgyHome(process.argv[2]);
     console.log('agy profile configuration ready');
   } catch (error) {
     console.error(error.message);
     process.exitCode = 1;
   }
   JS
   ```

   `configuration_unverified`이면 경로가 실제 디렉터리인지, 홈과 `.gemini` 및 `.gemini/antigravity-cli`의 소유자가 현재 사용자인지, 모드가 `0700`인지 확인합니다. `.gemini/config`는 없거나 비어 있어야 합니다. 이 검사는 로그인 여부나 모델 연결을 확인하지 않습니다.

4. **왕복 실행.** 위 검사가 통과하면 아래 명령으로 Codex → agy → Codex를 실행합니다. 모델 사용량이 발생합니다.

   ```sh
   npm run lab:matrix -- --live --worker codex --reviewer agy --agy-home "$agy_home"
   ```

성공하면 해당 조합이 `passed`이고 저장소 검사 11개가 모두 통과합니다. 시험 동안 agy에게 `receive`, `ack`, `send`만 허용하며 종료 후 시험용 설정 파일을 제거합니다. 전용 홈은 동시에 다른 agy 실행에 쓰지 않습니다. 일반 매트릭스는 기존 여섯 조합을 검사합니다.

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
