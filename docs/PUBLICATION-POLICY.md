# 공개 파일 및 배포 정책

2026-09-30. 공개 대상과 미검증 상태를 구분한다. 이 문서는 업로드 완료 보고가 아니다.

| 자료 | GitHub | npm | 규칙 |
| --- | --- | --- | --- |
| src, tests, scripts, lockfile | 공개 | 현재 files allowlist에 따라 제외 | fixture는 합성 데이터만 |
| dist | Git에는 제외 | 포함 | 빌드·검사한 산출물 |
| 설계, ADR, 계획, 연구, 사용 안내 | 공개 | 명시된 사용 안내만 | 개인 경로·계정 정보 제거 |
| plugins/durebak, canonical skill | 공개 | 현재 별도 배포 | credential 경로 고정값과 토큰 금지 |
| .github workflow, issue template | 공개 | 제외 | secrets는 GitHub 설정에 보관 |
| 검증 결과 docs/testing | 검토 후 공개 | 제외 | 버전·집계 usage·검사 결과만; 실제 대화/로컬 경로 금지 |
| .durebak, credential, native history, 백업 | 제외 | 제외 | 비공개 파일 권한 유지 |
| 생성한 세션별 MCP 설정 | 제외 | 제외 | 토큰이 없어도 개인 경로·identity 정보 포함 가능 |
| release/*.tgz, checksum | Git에는 제외 | tgz 자체가 배포물 | GitHub Release 첨부는 동일 artifact 검증 후 |

## 로컬 파일 위치

권장: `.durebak/credentials/`, `.durebak/config/`, `.durebak/logs/`, `.durebak/reports/`, `.durebak/backups/`. `.durebak/` 전체는 이미 ignore된다. 부모 디렉터리를 먼저 비공개 권한으로 만들고 사용한다. 임의 이름으로 저장소 루트에 내보낸 파일은 ignore가 자동 보호하지 않는다.

`plugins/durebak/.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, SKILL.md와 합성 JSON fixture는 추적해야 한다. `.codex/`·`.claude/` 전체 또는 `*.json`을 blanket ignore하지 않는다. 전역 사용자 설정을 저장소로 복사하지 않는다.

## 공개 직전 체크리스트

- [ ] 실제 GitHub owner, npm 이름/소유권, Apache-2.0 표기, 보안 신고 경로 확정.
- [ ] `git status --short`, `git ls-files`, `git log --all --format='%h %an <%ae>'`로 파일 및 공개 작성자 정보 검토. 출력은 로컬에서만 검토.
- [ ] 전체 공개 이력에 credential·실제 대화가 없는지 별도 검토. 현재 repo:check는 현재 파일 검사이며 history 검사기가 아니다.
- [ ] `npm run repo:check`, `npm run check`, `npm test` 통과.
- [ ] `npm run package:check` 및 **같은 tgz**를 입력한 설치 smoke 통과.
- [ ] 실제 GitHub CI와 릴리스 권한·환경·태그 보호 설정 확인.
- [ ] README/compatibility의 성공 표시에 실제 이종 호스트 증거가 있는지 확인.
- [ ] 최초 npm bootstrap/OIDC 설정과 정확한 버전의 registry 설치 검증.

구체적인 출판 명령과 부분 실패 복구는 [RELEASING](RELEASING.md)을 따른다. GitHub CLI 로그인과 소유자는 `ggujunhi247`로 확인했다. 공개 저장소는 `ggujunhi247/durebak`, 라이선스는 Apache-2.0이며 npm 출판은 별도 미완료 작업이다. 실제 원격 CI 결과는 저장소 Actions와 공개 실행 기록에서 확인한다. .gitignore 보충을 완료해도 이 항목들이 자동 완료되지 않는다.

## 최초 소스 공개

기존 개발 이력은 로컬 비공개 백업에 보존하고, 사용자 승인에 따라 공개 이력은 새 초기 커밋으로 시작한다. 공개 작성자에는 GitHub 비공개 이메일을 사용한다. 소스 알파 공개는 npm 릴리스·이종 실통신 지원 완료를 뜻하지 않는다. 공개 저장소에는 README의 검증 범위와 제한을 함께 게시한다.
