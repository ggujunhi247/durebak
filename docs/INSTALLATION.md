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

제품 내 새 버전 확인·알림과 자동 적용은 [업데이트 설계](UPDATE-DESIGN.md)에 정의한 후속 기능입니다. 이 설계는 설치 방식별 자동 적용·작업 중 보류·실패 복구까지 포함하며 현재 사용 가능한 명령과 구분합니다. 현재 CLI에는 `update-check` 또는 `update` 명령이 없으며 백그라운드 검사나 예약 작업을 설치하지 않습니다.

공식 npm 명령 참고: [npm install](https://docs.npmjs.com/cli/v11/commands/npm-install/), [npm view](https://docs.npmjs.com/cli/v11/commands/npm-view/).
