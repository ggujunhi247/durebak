# 새 버전 알림·자동 적용 설계 (제안)

상태: 사용자 요청에 따른 설계 검토본. 알림뿐 아니라 자동 적용까지 먼저 설계한다. 아래 명령·worker·예약 작업은 아직 구현하지 않았다. 현재 가능한 설치·수동 업데이트·GitHub 릴리스 구독은 [설치 안내](INSTALLATION.md)를 따른다. Windows 제품 지원은 기존 저장 보안·설치 실검증 관문 이후에만 활성화한다.

## 목표와 접근 선택

수정본이 배포되면 사용자가 배포처를 찾아다니지 않고 새 버전·적용 대기·성공·복구 필요 상태를 확인하도록 한다. 설치 소유자를 유지하고 진행 중인 협업과 데이터를 보호한다.

권장안은 **알림/정책 공통 코어 + 설치 소유자별 적용 worker**다. npm 파일을 직접 덮어쓰는 자체 updater 하나로 모든 설치를 처리하지 않는다. npm 설치는 npm, WinGet 설치는 정확한 package ID의 WinGet, 공식 직접 설치는 버전별 staging/전환을 사용한다. 모든 경로를 versioned launcher로 바꾸는 대안은 npm/WinGet의 버전 표시와 소유권을 불일치시킬 수 있어 첫 구현에서 채택하지 않는다. 업데이트 명령만 안내하는 대안은 보존하지만 자동 적용 요구의 완료 기준으로 삼지 않는다.

## 사용자 명령과 정책

제안 명령:

| 명령 | 동작 |
| --- | --- |
| `durebak update-check` | 선택 채널의 새 버전·배포처 조회; 설치 변경 없음 |
| `durebak update status` | 정책·현재/대상 버전·최근 결과·다음 검사·적용 대기 이유 표시; 네트워크 없음 |
| `durebak update enable --mode notify\|auto --channel alpha\|beta\|rc\|stable` | 설치 소유자와 실행 경로 확인 후 사용자 범위 정책·예약 작업 활성화 |
| `durebak update disable` | 일반 검사 예약 제거와 향후 자동 적용 차단; applying transaction의 독립 복구 경로는 종료 상태 확정까지 유지 |
| `durebak update pin VERSION` / `unpin` | 버전 고정/해제; 고정 중 자동 적용 없음 |
| `durebak update apply --version VERSION` | 검증된 후보를 지정하여 동일한 안전 관문으로 적용; unsafe 강제 적용 옵션 없음 |

`notify`는 검사와 알림만, `auto`는 안전 시점에 적용한다. 기본은 disabled이며 모드·채널은 사용자가 명시한다. 자동 검사 주기는 1시간, 부하 분산 jitter는 최대10분이다. 로그인 시 예약 worker가 대기 상태를 다시 확인한다. timeout 또는 일시적 실패의 같은 실행 내 재시도는 최대2회이며 이후 다음 예약으로 넘긴다. 수동 check는 즉시 조회한다. 사용자 버전 고정과 중지 설정을 긴급 수정이라는 이유로 무시하지 않는다.

stable/alpha/beta/rc를 분리한다. 최초 채널은 설치 버전의 prerelease 식별자로 제안하되 사용자가 확인한다. `latest`가 prerelease를 가리키면 stable 후보로 허용하지 않는다. SemVer로 숫자 비교하며 alpha.10이 alpha.9보다 최신이다. 낮은 버전은 자동 적용하지 않는다. `update_available`, `up_to_date`, `installed_ahead`, `unavailable`, `pinned`를 구분한다. 실패를 최신 상태라고 표시하지 않는다.

## 후보와 신뢰 경계

npm 게시·GitHub artifact·WinGet 카탈로그의 실제 사용 가능 상태를 각각 조회한다. npm 후보는 정확한 버전의 registry metadata가 확인된 경우만 허용한다. GitHub에만 게시된 수정본은 별도 직접 설치 후보로 표시하고 npm 설치 소유자를 자동 전환하지 않는다. WinGet 반영 전에도 직접 설치를 명시적으로 선택할 수 있지만 기존 설치를 확인·제거/전환하는 절차가 필요하다.

자동 적용용 릴리스 메타데이터는 schema1, package 이름, version/channel, OS/arch, bootstrap/updater 최소 버전, protocol/schema 호환 범위, artifact 고정 HTTPS URL·SHA256, 발행/만료 시각과 key ID를 갖는다. 다운로드 위치의 SHA256 파일만을 독립적인 진위 증명으로 사용하지 않는다. 배포 CLI에 포함된 신뢰 키로 Ed25519 서명을 검증하고, 신뢰 키를 같은 미검증 응답에서 받아 대체하지 않는다. 최초 키·CI 서명 운영·회전/폐기 절차는 별도 배포 보안 ADR로 확정해야 하며, 이 관문 이전에는 자동 적용을 활성화하지 않는다. npm registry integrity와 WinGet manifest hash도 함께 검사한다. 원격 metadata에 실행할 shell 명령을 넣지 않는다.

metadata 만료는 최대7일이다. 만료·시계 역행·서명 오류·key 불명·version/channel/OS/arch 불일치는 blocked로 남긴다. 공식 registry/GitHub의 명시한 HTTPS 출처만 조회하며 redirect 허용 출처도 고정한다. 요청별 timeout5초, metadata 본문 최대256KiB, redirect 최대2회, 설치 worker 실행 최대10분으로 제한한다. artifact는 선언 크기와 최대 크기를 검사하며 정확한 상한은 패키지 포맷 ADR에 고정한다. 세션/credential/workspace/대화를 원격 조회에 전송하지 않는다. 사용자 private registry credential을 공개 조회에 재사용하지 않는다.

## 설치 소유자와 적용 방식

| 설치 소유자 | 자동 적용 계약 |
| --- | --- |
| npm global | 사용자 소유·쓰기 가능한 prefix와 실제 실행 중인 패키지 경로가 일치할 때만 허용. 이전/새 정확한 tarball을 모두 staging·검증하고 별도 worker가 고정 npm CLI에 인자 배열로 exact version artifact 설치를 위임 |
| npm local, npx, 소스, 불명/복수 PATH | 첫 자동 적용에서 제외. 조회·알림과 설치 경로 확인/수동 명령만 제공; lockfile·다른 사본을 임의 수정하지 않음 |
| WinGet | 검증된 등록 package ID·source·설치 범위·버전 일치를 확인하고 그 패키지만 exact version upgrade. `upgrade --all` 또는 다른 설치 경로로의 자동 fallback 금지 |
| 공식 PowerShell 직접 설치 | 일반 사용자 전용 설치 root에 새 버전 staging·검증 후 launcher 대상 전환. 서명된 설치 코드 사용; 원격 응답 Invoke-Expression 및 전역 execution policy 완화 금지 |

npm global 갱신과 WinGet upgrade는 자체적으로 원자적이라는 가정을 하지 않는다. 실패 시 이전 artifact를 이용한 복구를 시도하고, 복구도 실패하면 `repair_required`로 중단하여 수동 복구 명령을 제공한다. 기존 버전 보존을 무조건 보장한다고 안내하지 않는다. 직접 설치의 전환 방식은 Win32 파일 잠금과 handle 기반 검증을 통과해야 한다. 관리자 권한이 필요한 prefix나 다른 계정 설치는 자동 적용하지 않는다. worker는 변경 대상 설치 폴더 밖에 검증된 독립 코드와 transaction 기록을 두어 업데이트 중 자기 파일이 바뀌지 않게 한다.

WinGet package ID·실제 설치 패키지 형식·Node runtime 포함 여부는 Windows 설치 ADR에서 확정한다. 미등록 ID나 존재하지 않는 PowerShell URL을 사용자 명령에 넣지 않는다. PowerShell 5.1/7, Windows11 x64/로컬 NTFS의 실제 실행 증거가 필요하다. Scoop/Chocolatey는 이 설계만으로 지원하지 않는다.

## 활성 작업·DB·동시 실행 보호

예약 worker는 기본 프로그램 시작/요청 처리 경로와 분리한다. 기본 CLI 실행은 네트워크를 조회하지 않는다. Windows는 사용자 범위 Task Scheduler의 로그인한 사용자 실행으로 설계하며 계정 비밀번호를 저장하지 않는다. 로그아웃 중 검사는 다음 로그인으로 미룬다. macOS/Linux 예약 backend는 해당 플랫폼 실검증 후 활성화하며 SYSTEM/root 작업을 만들지 않는다.

첫 자동 적용은 **daemon과 두레박 bridge가 종료된 안전 시점**에만 허용한다. 실행 중인 작업을 강제 중단하거나 타 도구 세션을 종료·중복 재개하지 않는다. 실행 중이면 후보만 준비하고 `waiting_idle`을 표시한다. daemon 종료만으로 협업 작업이 끝났다고 판단하지 않는다. maintenance gate를 획득한 뒤 모든 확인된 data-dir의 수락 상태 작업·실행 ledger를 읽기 전용으로 확인하고, 진행 중/unknown 실행이나 소유 상태를 확정하지 못하면 적용을 보류하여 reconcile을 안내한다. 고정 시각 안에 반드시 적용된다고 약속하지 않는다.

단순 PID 목록이나 lock 파일 부재만으로 idle을 판단하지 않는다. 신규 maintenance gate를 daemon 시작 및 모든 credential/DB 접근과 공유해야 한다. worker가 독점 gate를 획득한 동안 새 daemon/bridge 시작은 명확한 일시 중단 오류를 반환한다. 구버전처럼 이 gate를 제공하지 않는 runtime이 감지되면 자동 적용은 blocked이며 최초 수동 bootstrap 업그레이드를 안내한다. stale lock·PID 재사용·상태 불확실 시 강제 삭제/진행하지 않는다. 여러 data-dir 또는 설치 사본의 사용 여부를 확정하지 못해도 blocked다.

첫 자동 적용의 DB 관문은 현재와 후보의 schema/protocol 버전이 동일한 경우다. schema 변경은 `manual_migration_required`로 안내하고 자동 적용하지 않는다. 후속 migration 자동화는 별도 SQLite backup/복구 설계·시험 후 추가한다. 열린 WAL 파일 복사 또는 신버전 DB에 구 binary만 연결하는 rollback은 금지한다. 사용자 데이터 root는 기존 세션 또는 명시적인 daemon 설정으로 확인하며 shell 기본 경로를 실제 daemon 경로로 가정하지 않는다.

## 상태·건강 검사·복구

상태 흐름은 `detected → downloaded → verified → waiting_idle → applying → verifying → applied`다. 실패하면 적용 전 `blocked/failed`, 적용 후 `rollback_pending → rolled_back/repair_required`로 간다. transaction ID·설치 소유자·기존/대상 version·artifact digest·단계·오류 코드만 private journal에 남긴다. credential·대화·SID·실제 사용자 경로는 공개 로그에 넣지 않는다. journal의 생성 시 private 권한·identity·무결성 검사는 저장 보안 backend를 사용한다.

applying 전에 설치 폴더 밖의 검증된 standalone recovery entry와 로그인 시 recovery-only 예약을 생성하고 실행 가능 여부를 확인한다. 확인 실패 시 적용하지 않는다. 이 예약은 일반 검사 예약과 분리하고 disable로 제거하지 않는다. 복구 worker는 진행 중 transaction만 검증/복구하며 새 후보 조회나 새 업데이트 적용을 하지 않는다. applied/rolled_back/repair_required 상태가 확정된 뒤 recovery-only 예약을 제거한다. repair_required일 때도 독립 수동 복구 entry·검증된 이전 artifact·journal을 보존해 제품 CLI가 깨져도 접근할 수 있게 한다. 로그인 예약이 실행되지 않는 경우의 동일 standalone 복구 명령을 status와 설치 문서에 안내한다.

같은 설치의 updater는 하나만 gate를 소유한다. 전원 중단 뒤 다음 worker는 journal과 실제 설치 version을 비교하고 이어서 검증/복구하며 무조건 재설치하지 않는다. disable/pin 변경은 applying 전에 다시 확인한다. disable 도중 전원 중단이 있어도 이미 applying인 transaction의 복구 예약/entry가 남는 순서를 crash fixture로 검증한다. applying 이후에는 transaction을 안전하게 마무리하거나 복구하고 다음 자동 실행을 중단한다.

새 artifact는 적용 전에 격리된 synthetic 데이터로 설치 smoke(CLI/HTTP/MCP)를 통과해야 한다. 적용 뒤 실제 설치 경로의 version과 새 프로세스 기본 실행을 검증한다. daemon이 정상 종료된 상태의 업데이트이므로 자동으로 타 세션을 깨우거나 실제 daemon을 재시작하지 않는다. `applied`는 프로그램 설치 검증 성공이며 실제 협업 runtime의 재시작 성공은 별도 상태다. 다음 사용 시 doctor에서 runtime/client 호환성을 다시 확인한다.

알림은 새 버전 발견·적용 대기·적용 검증 성공·rollback·복구 필요를 구분한다. CLI TTY stderr와 `update status` JSON을 우선 사용한다. stdout JSON·MCP stdio에는 텍스트 알림을 삽입하지 않는다. 같은 version/상태 알림을 반복하지 않으며 Windows native toast는 별도 실검증 후 지원한다. 적용됐다고 알릴 때 실제 version을 함께 표시한다. 예약 실행 시 터미널이 없으면 private 상태에 남기고 사용자가 status에서 확인하도록 한다.

## CI/CD와 빠른 수정 전달

재현 회귀 → 3개 OS 검사 → pack once/서명 → 동일 artifact 설치·N-1 업그레이드·실패 복구 → GitHub/npm 게시 → 배포처별 메타데이터 검증 → 서명된 채널 metadata → WinGet manifest 제출 순서다. 배포처별 성공을 구분하며 npm 실패 시 해당 버전의 npm 적용 후보를 활성화하지 않는다. 이미 배포한 version/tag/asset을 덮어쓰지 않는다.

GitHub 릴리스 구독은 현재 즉시 쓸 수 있는 발견 경로다. 자동 적용이 구현돼도 카탈로그 승인·사용자 opt-in·pin·활성 작업·네트워크에 따라 적용이 지연될 수 있다. 불량 버전은 신뢰 가능한 갱신 metadata에서 신규 후보로 제외하고 호환되는 후속 수정본으로 안내한다. 강제 downgrade나 사용자 정책 우회로 긴급 패치를 배포하지 않는다.

## 구현 단위와 검증 관문

1. 읽기 전용 후보 해석·버전 비교·명시적 update-check/status. npm 미게시/GitHub만 게시, installed-ahead, alpha.9/10, latest prerelease, offline/timeout/redirect/초과 응답/잘못된 JSON/control 문자·비공식 URL을 시험한다.
2. private 정책·journal·maintenance gate·notify 예약 worker. 기본 CLI 무네트워크, MCP/JSON 출력 불변, opt-out·pin·중복 worker·다중 data-dir·PID 재사용·구버전 미지원·활성 작업 보류를 시험한다.
3. 신뢰/서명 ADR와 설치 소유자별 apply/복구. hash/signature 오류, prefix/PATH 충돌, 잠긴 실행 파일·디스크 부족·다운로드 중단·전원 중단, npm/WinGet 부분 실패 및 복구 실패, applying 중 disable 후 전원 중단과 독립 recovery-only 재개를 실제 시험한다.
4. Windows 설치 ADR·WinGet 등록·PowerShell 직접 설치·사용자 예약 작업. 일반 사용자 깨끗한 설치/제거, N-1→N, 동일 version 재실행, 한글/공백 경로, PS5.1/7, catalog 반영 전후, disabled/pinned, schema 변경 자동 차단을 실제 artifact로 시험한다.
5. 세 OS 회귀·패키지 allowlist·보안 리뷰·출처별 배포/적용 근거 후 기능별 지원표를 갱신한다. Windows 핵심 저장/설치/복구 시험 skip은 출시 실패다.

구현 전 승인할 설계 범위는 위 자동 적용 계약까지다. 서명 운영 및 Windows 패키지 ADR의 미확정 값은 실제 조사 결과로 별도 확정하며, 그 전에도 읽기 전용 조회/알림 구현은 독립적으로 검증할 수 있다.
