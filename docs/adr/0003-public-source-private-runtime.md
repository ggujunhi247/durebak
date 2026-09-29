# ADR 0003: 공개 소스와 비공개 런타임 데이터를 분리한다

- 날짜: 2026-09-30
- 상태: Accepted — GitHub/npm 출판은 미실행
- 근거: [공개 파일 정책](../PUBLICATION-POLICY.md), [기존 배포 계획](../superpowers/plans/2026-09-29-public-release.md)

## 결정

소스·테스트·합성 fixture·문서·ADR·공유 스킬·토큰 없는 플러그인 manifest·CI를 GitHub에 공개한다. 인증정보, 실제 사용자 대화, native session export, runtime DB, 로그, 백업과 생성 설정은 공개하지 않는다.

로컬 생성 파일의 권장 위치는 gitignored `.durebak/` 또는 저장소 밖 private 디렉터리다. npm은 package.json files allowlist로 배포하며 GitHub 파일 전체를 포함하지 않는다. GitHub Release 첨부물은 검사한 tgz/checksum/비민감 보고서만 허용한다.

.gitignore는 실수 방지이며 비밀 탐지나 접근 통제가 아니다. 이미 추적한 파일과 Git 이력을 보호하지 못한다. 공개 전에 파일 목록·이력·작성자 이메일과 실제 package 파일 목록을 별도로 검토한다. secret 발견 시 원문을 로그에 남기지 않고 폐기·재발급부터 처리한다. 공유 이력 재작성은 별도 결정한다.

## 대안과 비용

모든 JSON/TOML이나 dot-directory를 무시하면 credential 실수는 줄어도 플러그인 manifest·fixture·설정 예제가 누락된다. 따라서 이름이 알려진 민감 파일과 생성 디렉터리를 좁게 제외한다. 임의 파일명의 비밀까지 막지 못하므로 출판 검토가 필요하다.

## 검증

`git check-ignore --no-index`, `npm run repo:check`, `npm run package:check` 및 수동 이력 검토를 함께 사용한다. private=true는 npm 보호장치이며 GitHub 공개 여부와 별개다. 소유자/로그인/신고 경로가 확정되기 전 guessed URL이나 출판 성공 표시를 넣지 않는다.
