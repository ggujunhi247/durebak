# 설치·업데이트·새 버전 알림

두레박의 npm 배포, GitHub 배포 파일, 개발 소스는 서로 다른 경로입니다. GitHub Release 게시가 npm 게시 성공을 뜻하지는 않습니다. 현재 제품 실행 대상은 macOS/Linux, Node.js 24 이상입니다. Windows native 실행·WinGet·PowerShell 전용 설치기·제품 내 자동 업데이트는 아직 지원하지 않습니다.

## 어디서 받나요?

| 경로 | 주소 | 확인할 내용 |
| --- | --- | --- |
| npm | [durebak 패키지](https://www.npmjs.com/package/durebak) | 실제 게시 버전·dist-tag |
| GitHub 배포 | [Releases](https://github.com/ggujunhi247/durebak/releases) | 버전별 `.tgz`, `SHA256SUMS`, 검증 보고서·변경점 |
| 개발 소스 | [저장소](https://github.com/ggujunhi247/durebak) | 아직 배포되지 않은 변경 포함 가능 |
| 게시 절차 | [Release runbook](RELEASING.md) | CI/CD·OIDC·게시 재시도 및 검증 |

2026-10-11 조회 시 npm `alpha`는 `0.1.0-alpha.22`, `latest`는 `0.1.0-alpha.2`이며, GitHub에는 `v0.1.0-alpha.23` 배포 파일이 있습니다. 이는 조회 시점의 기록입니다. 설치 직전 아래 명령으로 다시 확인하세요. alpha.23 npm 게시 시도는 실패했으며 GitHub 파일 배포와 구분합니다. `latest`가 가장 최근 alpha라고 가정하지 마세요.

## npm 설치·업데이트

지원 OS에서 먼저 실제 배포 버전을 확인합니다. 아래 조회는 설치를 바꾸지 않습니다.

```sh
node --version
npm view durebak dist-tags --json --registry=https://registry.npmjs.org
npm view durebak@alpha version --registry=https://registry.npmjs.org
```

전역 설치의 최초 설치·업데이트 명령은 같습니다. **업데이트 전 현재 버전과 대상 버전을 비교하고 아래 안전 절차를 따르세요.** GitHub에서 더 최신 버전을 설치한 경우 `@alpha` 명령이 이전 버전으로 되돌릴 수 있습니다.

```sh
npm install --global durebak@alpha --registry=https://registry.npmjs.org
durebak --version
```

버전을 고정하려면 실제 게시를 확인한 버전을 지정합니다. 다음은 조회 시점에 게시된 버전의 예이며, alpha.23을 설치하는 명령은 아닙니다.

```sh
npm install --global durebak@0.1.0-alpha.22 --registry=https://registry.npmjs.org
```

일시 실행은 `npx --yes durebak@alpha --help`입니다. 서버·MCP처럼 계속 실행할 구성은 정확한 버전 또는 전역 설치를 선택하세요. `npx`를 다시 호출했다고 이미 실행 중인 서버가 갱신되지는 않습니다.

## GitHub 배포 파일 설치

npm 게시가 아직 안 된 버전은 [해당 GitHub Release](https://github.com/ggujunhi247/durebak/releases/tag/v0.1.0-alpha.23)의 `.tgz`와 `SHA256SUMS`를 받습니다. 버전 URL의 공식 파일만 사용하고 내려받은 `.tgz`의 SHA256을 비교하세요. SHA256은 파일 일치 검사이며, 같은 배포처에서 받은 checksum만으로 독립적인 게시자 서명을 증명하지는 않습니다.

예를 들어 alpha.23 파일을 받은 디렉터리에서 macOS는 `shasum -a 256 --check SHA256SUMS`, Linux는 `sha256sum --check SHA256SUMS`를 실행합니다. 성공한 파일만 설치합니다.

```sh
npm install --global ./durebak-0.1.0-alpha.23.tgz
durebak --version
```

이 파일은 Windows 지원 설치기가 아닙니다. Windows의 `Get-FileHash -Algorithm SHA256`으로 파일을 확인할 수 있어도 제품 실행이 검증되는 것은 아닙니다. WinGet package ID와 PowerShell 설치 URL은 아직 등록·배포하지 않았습니다.

## 실행 파일·데이터는 어디에 있나요?

OS별 설치 위치를 하드코딩하지 않습니다.

```sh
npm prefix --global
npm root --global
command -v durebak
durebak paths --session FILE
```

앞의 두 명령은 npm 전역 prefix와 모듈 위치, `command -v`는 현재 shell이 선택한 실행 파일, `durebak paths --session FILE`은 지정한 기존 세션이 사용하는 데이터 위치입니다. `FILE`은 본인의 세션 credential 파일로 바꾸세요. 세션 파일이 없으면 daemon을 실행할 때 사용한 것과 같은 `--data-dir PATH` 또는 환경 설정으로 `durebak paths --data-dir PATH`를 실행하세요. 인자 없는 `durebak paths`는 현재 shell의 기본값이며 실행 중인 daemon의 경로를 자동 탐색하지 않습니다. 기본 새 데이터 경로는 `~/.durebak`이며 기존 경로·명시적 설정은 우선합니다. 프로그램 업데이트와 DB·credential 저장 위치는 별개입니다. 데이터 디렉터리를 패키지 폴더로 옮기지 마세요.

PowerShell에서는 shell의 실행 파일 조회에 `Get-Command durebak -All`을 사용합니다. 이 명령은 설치 충돌 확인용이며 Windows runtime 지원을 뜻하지 않습니다. 로컬 npm 설치·npx·소스 빌드라면 전역 설치 명령으로 해당 사본이 갱신되지 않습니다. MCP 설정이 가리키는 Node/CLI 경로도 확인하세요.

## 안전하게 업데이트하기

1. 실행 중인 버전과 목표 버전의 변경점·[호환성 안내](COMPATIBILITY.md)를 확인합니다. 현재 버전보다 낮은 채널 대상은 업데이트로 취급하지 않습니다.
2. 진행 중인 작업을 마치고 서버와 두레박 MCP bridge를 정상 종료합니다. Claude Code·Codex·OpenCode의 활성 세션을 임의로 종료하거나 중복 재개하지 않습니다.
3. 위 경로 확인 절차로 해당 daemon의 데이터 위치를 확정하고, DB를 사용하는 두레박 프로세스가 종료됐는지 확인한 뒤 그 데이터 디렉터리 전체를 private 위치에 백업합니다. Unix 권한을 유지하고 열린 DB/WAL의 단순 복사를 정상 백업으로 간주하지 않습니다.
4. 설치한 경로에 맞게 정확한 버전의 npm 또는 GitHub 파일을 설치합니다. 권한 오류를 이유로 무조건 관리자 설치로 전환하지 않습니다.
5. `durebak --version` 확인 후 서버를 재시작합니다. 사용 중인 credential 파일로 `durebak doctor --session FILE`을 실행하고 bridge를 다시 연결합니다. `FILE`은 본인의 기존 세션 파일로 바꿉니다.

새 DB schema에 이전 binary만 연결해 되돌리지 마세요. rollback은 호환성을 확인한 뒤 중지된 서버의 사전 백업과 이전 binary를 함께 복원하는 별도 절차입니다. 업데이트 실패·인증 오류를 성공으로 표시하거나 같은 게시 버전을 덮어쓰지 않습니다.

## 새 버전 알림 받기

지금 사용할 수 있는 알림은 GitHub의 릴리스 구독입니다. [저장소](https://github.com/ggujunhi247/durebak)에서 **Watch → Custom → Releases**를 선택하고 계정의 알림 전달 설정을 확인하세요. 이메일·GitHub 알림함 전달은 계정 설정에 따릅니다. [GitHub 공식 알림 안내](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications)

GitHub 릴리스 알림은 그 릴리스가 게시됐다는 뜻입니다. npm 게시·사용자 기기의 업데이트 적용·daemon 재시작 성공을 알리는 메시지는 아닙니다. 특히 현재 alpha 릴리스의 구독 전달 여부는 계정 설정에서 확인하고 Releases 페이지도 함께 확인하세요.

수동 확인은 `durebak --version`과 `npm view durebak@alpha version --registry=https://registry.npmjs.org`를 비교하면 됩니다. 두 버전이 다르다는 이유만으로 업데이트 가능한 것은 아닙니다. 현재 버전이 채널보다 앞설 수도 있습니다.

## 개발 소스의 제품 내 업데이트 확인·알림

아래 명령은 현재 개발 소스에 구현되어 있으며 **기존 alpha.23 배포 파일에는 포함되지 않습니다**. 새 버전 확인·알림·정책을 제공하며 설치 파일을 변경하지 않습니다. 자동 설치/rollback은 아직 구현되지 않았습니다.

```sh
durebak update-check --channel alpha
durebak update status
durebak update enable --mode notify --channel alpha
durebak update pin 0.1.0-alpha.23
durebak update unpin
durebak update disable
```

`update-check`는 npm과 GitHub를 따로 조회하여 현재 버전·후보·게시 여부를 JSON으로 표시합니다. `installed_ahead`는 설치 버전이 해당 배포처보다 높다는 뜻이며 downgrade를 제안하지 않습니다. GitHub는 최대50개 최신 릴리스를 확인하고, 선택 채널을 찾지 못하면 `unavailable`입니다. 설치 소유자는 아직 검증하지 못하므로 임의 전역 설치 명령을 생성하지 않고 이 안내 링크를 제공합니다.

기본 정책은 disabled입니다. `enable --mode notify`를 명시하면 macOS launchd 또는 Linux systemd 사용자 예약을 등록합니다. Linux에는 실행 중인 systemd user manager가 필요하고 macOS에는 로그인한 GUI 세션이 필요합니다. root/SYSTEM 예약은 거부합니다. worker가 분 단위로 깨어나도 네트워크 검사는 1시간 간격이며 disabled 상태에서는 조회하지 않습니다. Windows 예약은 지원하지 않습니다.

정책과 최근 결과는 runtime DB와 분리된 `~/.durebak-updater`에 private 권한으로 저장합니다. 별도 정책 root는 각 명령에 같은 `--update-dir PATH`를 지정합니다. 대화형 CLI의 자동 알림은 기본 root의 캐시만 읽으며, 사용자 지정 root의 결과는 해당 root의 `update status`로 확인합니다. 기본 CLI 실행과 status는 네트워크를 조회하지 않고 MCP/stdout JSON에는 알림을 넣지 않습니다. 알림은 TTY stderr에서 한 번 표시합니다. 터미널이 없을 때는 status로 확인합니다.

`pin`은 후보 상태를 pinned로 표시하고 새 버전 알림을 중지합니다. `disable`은 정책부터 중지한 뒤 소유가 확인되는 예약만 제거합니다. 예약 파일이 외부에서 수정되면 덮어쓰거나 삭제하지 않고 conflict를 반환합니다. 제거 실패여도 disabled 정책은 유지합니다. 알림을 다시 켜면 소유한 예약 파일을 재검사·등록합니다.

`update enable --mode auto`와 `update apply --version VERSION`은 `automatic_apply_not_configured`로 차단됩니다. `update status`의 `apply_blockers`는 운영 서명 키, 설치 소유자, maintenance gate, 독립 복구 worker 부재를 표시합니다. 자동 설치·DB 관문·실패 복구와 Windows 설치기는 [업데이트 설계](UPDATE-DESIGN.md)의 남은 구현 범위입니다. 테스트용 서명 검증 성공을 운영 자동 적용 지원으로 보지 않습니다.

공식 npm 명령 참고: [npm install](https://docs.npmjs.com/cli/v11/commands/npm-install/), [npm view](https://docs.npmjs.com/cli/v11/commands/npm-view/).
