# 구현 현황 — 0.1.0-alpha.5

이 문서는 실행 가능한 범위를 설명한다. 전체 제품 스펙 v0.4는 목표 계약이며 이 alpha에서 모두 충족하지 않는다.

## 구현된 계약

| 영역 | 동작과 한계 |
|---|---|
| 런타임 | 데이터 디렉터리당 foreground daemon 하나, 127.0.0.1 임의 포트, HTTP JSON 인증 |
| 참여 | 사용자 CLI 등록, 고정 credential MCP bridge; provider 표시는 실제 호스트 검증이 아님 |
| 인증 | admin/session 분리, token hash 저장, 회수, Origin/Host 검사 |
| 격리 | canonical workspace 경로 hash; 세션 workspace는 서버가 credential에서 결정 |
| 메시지 | 정책 기반 durable queue, request/reply, 보낸이·받는이만 본문 조회, idempotency conflict, pending 100개 backpressure |
| 읽음 | receive의 30초 lease·receipt 기반 ack, 5회 한도 재전달·TTL 만료; 조회·읽음·작업 완료를 분리 |
| 작업 | 생성·목록·조회, version 기반 원자적 claim, 수락자 결과 제출, 생성자 취소 |
| 산출물 | 최대 64 KiB UTF-8 텍스트, workspace별 SHA-256 불변 원본 |
| 조회 | cursor 페이지, 원문 최대 4096 bytes; HTTP 응답 최대 16 KiB |
| 캐시 | workspace/hash/range/가공기 버전 key, 파생 데이터만 삭제, workspace 256 MiB LRU |
| 기록 | DB 기준 결정적 Markdown, LLM 0회, 명시적 export만 파일 생성, 덮어쓰기 충돌 거부 |
| 복구 | 정상 재시작 후 session token·메시지·작업 유지. 강제 종료 stale lock은 사람이 종료 확인 후 제거 |
| 배포 준비 | Apache-2.0, lockfile, ignore 규칙, npm allowlist 검사, CI, 보안·기여 문서 |

## 아직 구현하지 않은 계약

- Managed/Attached provider adapter, 활성 호스트의 identity 검증·재연결·자동 wake.
- 작업 DAG, 검토→수정→검증 자동 라운드, 정책 digest·독립 증거를 이용한 완료 gate.
- 실행 lease·프로세스 실제 정지 확인·자동 crash recovery. claimed 작업을 임의 재실행하지 않는다.
- 역할별 context assembler, context epoch/delta base, 한 모델 턴 전체의 누적 토큰 예산.
- Provider prompt cache 제어·usage/cost 정규화·실제 비용 절감 측정.
- 학습 후보 채택, 전문 검색/FTS, 자동 문서 색인·보존 기한 정리, artifact 삭제/tombstone.
- 대형/바이너리 artifact, SSE push, 원격 호스트, 자동 호스트 설정 설치 및 플러그인 패키지.
- browser 협업 화면·watch 갱신은 후속 단계다. CLI 협업 화면과 보호 task·첨부·revision/evidence는 alpha.5 소스에 구현했다. 기존 공개 task/artifact의 workspace 범위는 유지한다.

현재 task version은 작업 상태 revision이다. artifact hash는 내용 revision이며 자동 review gate와는 별개다. 세션 ID는 두레박 등록 ID이고 호스트 native session ID와 매핑하지 않는다. 세션별 MCP 설정을 유지할 수 없는 호스트에서는 동일 identity 공유를 방지하는 별도 연결 방식이 필요하다.

## 검증 범위

자동 테스트는 SQLite 저장·복구, 권한과 workspace 경계, 작업 경쟁, 큐 정책, HTTP·MCP 통신 및 기록 내보내기를 확인합니다. Linux·macOS CI에서 타입 검사, 테스트와 패키지 설치 검증을 실행합니다. 최신 결과는 [GitHub Actions](https://github.com/ggujunhi247/durebak/actions)를 확인하세요.

실제 모델을 통한 Codex↔Codex cooperative 통신은 확인했습니다. Claude Code·OpenCode와의 이종 실통신, native resume·자동 wake는 검증된 지원에 포함되지 않습니다. 재현 절차는 [호스트 테스트](HOST-TESTING.md), 지원 범위는 [호환성](COMPATIBILITY.md)을 따릅니다.

## alpha.3 연결 관측과 기능 근거

추가 후보를 비활성 상태로 보여주는 harnesses catalog, epoch별 MCP bridge 접촉과 별도 CLI 활동, 읽기 전용 session_health 및 doctor 검사별 안내를 추가했다. schema 3→4 migration은 원본 credential·message·task·artifact·delivery audit/cursor를 보존한다. 설정 출력은 config_fragment/renderer_tested이며 native_session_isolation은 unverified다. 실제 신규 host·native 자동 wake는 지원 완료로 표시하지 않는다.

2026-10-04 alpha.3 로컬 검증: 전체 시험 94개, 타입 검사, 저장소/비밀정보 검사, 53개 파일 tarball allowlist 및 독립 설치 smoke 통과. MCP 초기 협업 지침과 기본 로컬 저장 경로 기능을 보존했다. 실제 코딩 host 실연동 결과와 별개다.

## alpha.4 요청과 재접속 계약

두 참여자의 요청별 대화, 고정 응답 기한(기본10분/최대60분), expected version 기반 수락·거절·실패·취소, 지연 도착 결과의 감사 보관을 추가했다. recipient는 최초 전달 전 본문을 대화 조회로 우회하지 못한다. `completed`는 수락한 수신자의 결과 제출이며 독립 검증이 아니다. 취소·만료 notice는 일반 메시지 큐의 적체·pause와 별도이며, notice 확인은 host 정지 증거가 아니다.

세션별 consumer checkpoint는 관측된 전달/control cursor와 CAS version을 보존한다. 원문·credential·실제 native 대화는 저장하지 않는다. checkpoint 복구는 메시지 ACK·요청 수락·native 재개·자동 실행을 하지 않는다. 스키마4→5는 기존 표를 변경하지 않고 새 요청/control/checkpoint 표를 추가한다. 이 개발 내용은 기존 alpha.3 배포 파일에 소급 적용되지 않는다.

2026-10-04 개발 검증: 전체 시험 118개와 타입·패키지 allowlist·저장소·비밀정보 검사 통과. 실제 HTTP→MCP 요청/수락/결과/재접속 시험, 기한 경계 경쟁, 미관측 notice 건너뛰기 차단, 전체 JSON 페이지 한도, 저장 오류 주입의 원자적 롤백, 독립 schema4 fixture의 자격증명·메시지·delivery cursor 보존을 검증했다. 실제 native 자동 wake 검증은 포함하지 않는다.

alpha.4 공유 미리보기: 발신자 전용 60초 preview와 원문 범위 조회, request_create의 선택적 previewId 검증을 추가했다. 정규화된 본문 요청만 지원하고 첨부·보호 task는 후속이다. 미리보기는 host 준비 확인·전송 승인 권한·읽음 처리·자동 실행이 아니다. schema5→6은 preview 표만 추가한다.

alpha.4 로컬 검증: 전체128개, 타입·57개 package allowlist·독립 설치 smoke·저장소·gitleaks 통과. 별도 reviewer가 preview의 Critical/Important 문제 없음 및42개 집중 시험 통과를 확인했다. CI·registry 게시 상태는 release 결과로 별도 확인한다.

## alpha.5: request-linked 보호 작업

선택적인 새 task를 request와 원자적으로 생성하고 참여자 ACL·최초 전달 조건을 legacy task 목록/조회/record/events에도 적용한다. legacy mutation은 연결 요청 연산을 요구하며, request/task version을 함께 검사해 수락·결과·종료를 한 transaction에서 반영한다. revision 없는 결과 hash는 기존 workspace-visible artifact이며 private 결과는 아래 schema9 revision 계약을 따른다. schema6→7은 mapping 표를 추가한다. 기존 alpha.4에는 포함되지 않은 개발 내용이다.

2026-10-04 보호 작업 개발 검증: 전체139개·타입·59파일 패키지 allowlist·저장소112파일·gitleaks 통과. 독립 리뷰의 Critical/Important 문제 없음, 집중37개 통과. 실제HTTP/MCP 기준 조회/legacy mutation 차단/양쪽version 수락·완료, storage failure 원자성, 독립released schema6 fixture의 원래 request/preview/credential 보존을 확인했다. 아직 alpha.4 출시 파일에 포함되지 않는다.

다음 단계 private 첨부 개발: owner-only immutable upload와 message-linked request handle을 분리 저장한다. 참여자 ACL/최초 전달 조건을 적용하며 legacy hash/cache로 private 원본을 읽지 못한다. 동일 공개본은 명시적으로 표시하고 preview 생성 뒤 범위 변화는 send-time conflict로 거부한다. schema7→8이 원본/handle 표와 preview attachment digest를 추가한다. 아직 alpha.4 지원 범위가 아니다.

2026-10-04 private 첨부 개발 검증: 전체151개·타입·61파일package allowlist·독립설치smoke·저장소114파일·gitleaks 통과. 독립review의종료late-result첨부누락1건을cancelled/timed_out 회귀로재현해명시거부로수정했다. 구preview NULLdigest호환·원자rollback·quota/barrier/redaction·HTTP/MCP handle ACL을검증했다. 아직alpha4태그/릴리스와분리된개발코드다.

## alpha.5: revision과 재검증 근거

schema8→9에 불변 task revision·self_reported verification evidence와 완료 메시지 접근 경계를 추가한다. accepted recipient만 요청/작업 dual version으로 owner 전용 upload를 revision에 연결하고 정상 전달 note·비공개 handle·작업 version 증가를 한 transaction으로 처리한다. 최신 revision이 있는 완료 결과는 그 hash로 고정하며 결과 메시지가 전달되기 전 legacy task/record와 request summary에서 hash를 숨긴다. 기존 공개 artifact 결과는 revision 없는 보호 작업과 legacy task에서 유지한다.

검증 보고는 정확한 revision/고정 기준 digest, 작성자, attempt와 연결한다. 같은 작성자의 동일 revision 이력만 supersede할 수 있다. 활성 실패는 통과보다 우선하고 충돌은 별도 표시한다. 이전 revision의 보고는 최신 결과 통과로 승격되지 않는다. procedure 원문은 bounded source API로 조회하며 참여자·revision 전달 ACL을 적용한다. 두레박이 실제 테스트 명령을 실행하는 runner는 포함하지 않는다.

모델 호출 없는 bounded request_bundle은 원문 참조와 self_reported 출처를 제공하며 source_complete:false를 명시한다. Native Managed 자동 실행·실제 이종 Provider 검증·browser 협업 UI는 별도 후속 단계다. 기존 alpha.4 release는 schema6이며 이 개발 내용을 포함하지 않는다.

## alpha.5: 협업 상태 snapshot

`collaboration_status`와 `durebak dashboard`를 추가해 같은 workspace의 공개 세션 연락 metadata와 자신의 참여 요청 상태를 본문 없이 조회한다. 자기 건강·bridge duplicate·availability와 host unknown을 구분하고 completed와 self_reported 검증 상태를 분리한다. 세션20개/요청10개 pagination과 alias 잘림을 표시하며 터미널 제어/bidi 문자를 escape한다. 인증된 HTTP/MCP/CLI에 같은 계약을 적용하고 조회는 activity touch·receive·ACK·claim·native 실행을 하지 않는다. 브라우저 UI와 자동 갱신은 미포함이다.


## alpha.5 릴리스 후보 검증

immutable alpha.5 소스는 schema9, 보호 작업·private 첨부·첨부 preview·불변 결과 revision·self_reported evidence/재검증·bounded work bundle·one-shot CLI 협업 화면을 포함한다. 전체168개 테스트, 타입 검사,65파일 package allowlist·독립 설치 smoke·저장소·gitleaks와 PR21/22의 Linux/macOS CI를 통과했다. 독립 리뷰에서 revision3개/화면2개의 Important 문제를 각 RED→GREEN 후 수정하고 전체 회귀를 다시 실행했다. 이 문서의 alpha.3/alpha.4 및 schema7/8 단락은 단계별 검증 이력이며 과거 release 파일에 새 기능을 소급하지 않는다.

npm registry 게시와 GitHub artifact 전달은 release workflow 결과로 각각 확인한다. 소스의 version 표시는 registry publish 성공을 뜻하지 않는다. 실제 Claude/OpenCode 이종 모델 왕복·native Managed wake·자동 검증 명령 실행은 이 테스트 결과에 포함되지 않는다.

## schema10 개발: Managed 관리자 설정

alpha.5 immutable release는 schema9입니다. 이후 개발 소스는 관리자 전용 native binding·on/off grant·owner renewal·자기 설정 조회를 추가합니다. 기본 off이며 세션/peer는 grant를 생성하거나 변경할 수 없습니다. runtime-local 선언 profile/native ID 유일성, owner credential 1회 발급과 비공개0600 파일, version/epoch CAS, durable scope·사용량 보존, clock high-water와 만료 latch를 검증합니다. 실제 identity 검증·machine-wide fencing·wake selection·예약·driver·model turn은 아직 구현 범위가 아닙니다. `auto_wake:false`, readiness unverified, stop unknown을 유지합니다.

독립 리뷰에서 만료 관측 후 clock rollback에 의한 grant 부활과 off-state TTL 소실을 발견했습니다. 3개 재현 테스트가 실패하는 것을 확인한 뒤 durable observation/TTL 저장으로 수정했습니다. schema1–9 migration은 변경하지 않고 독립 released schema9 fixture의 credential/request 보존을 확인합니다.

## schema10 개발: 실행 입력 준비

내부 WorkInput은 명시적 대상 메시지까지의 request-prefix를 snapshot transaction으로 수집한다. 원문 메시지·작업 기준·private 첨부·prefix revision 이력·관련 self_reported evidence·revision 없는 공개 결과 원문을 포함하고 누락/손상/16KiB 초과를 거부한다. 이후 메시지는 이 범위 밖이며 새로운 revision이 이미 생성되어 현재 trigger의 범위와 충돌하면 거부한다. 전달 예정 prefix의 note는 결과와 함께 준비할 수 있지만 note 자체는 실행 trigger가 아니다. snapshot은 전달/읽음/수락이나 activity를 변경하지 않는다.

이 모듈은 공개 session API나 native driver가 아니다. prepare와 예약을 구분하며, 후속 controller는 같은 lock에서 pending_delivery_ids 전체의 경쟁·policy/owner epoch·shared budget·source digest를 재검증하고 durable attempt를 저장해야 한다. 실제 delivery receipt는 실행 입력을 받은 시점과 연결해야 하며 preparation 성공을 모델 실행/접수/완료 근거로 사용할 수 없다. 독립 리뷰에서 공개 결과 원문 및 이전 revision evidence 누락2건을 발견하고 실패 테스트 후 수정했다. 추가로 queued revision note가 결과 continuation을 막는 경우를 회귀 테스트로 확인하고 prefix delivery-intent source에 포함했다.

## schema10 개발: 협업 스킬·커맨드

`durebak skills --harness codex|claude-code|opencode|all --workspace PROJECT`는 프로젝트별 공통 협업 스킬과 도구별 호출 진입점를 설치한다. 공통 원문은 compiled module에 포함되므로 npm allowlist를 확대하지 않는다. Credential·runtime path·실제 대화는 생성 파일에 들어가지 않는다. 별도의 MCP 연결/세션 등록이 필요하며 installer 자체는 모델/호스트를 호출하지 않는다.

독립 behavioral baseline은 실제 API 형식을 알 수 없어 수락/응답을 구체화하지 못했다. 생성 스킬과 reference를 받은 독립 forward exercise는 full-source 읽기·현재 request/task version 수락·answer 응답·관계없는 cancel 구분·이전 revision evidence의 불확실성 유지 절차를 선택했다. 이는 실제 Claude/Codex/OpenCode 모델 실행의 검증이 아니다. 초기 연결 command를 reference에 추가해 발견된 onboarding 공백을 보강했다.

독립 코드 리뷰의 Important1건(부분 write 실패가 broken SKILL을 남겨 재설치 충돌)도 실패 회귀로 재현 후 exclusive open 직후 소유 파일을 추적하도록 수정했다. 동시 작성자의 EEXIST 파일은 보존한다. 실제 CLI installer와 도구별 생성 MCP config의 command/args로3개 독립 stdio bridge를 연결해 등록 provider codex/claude/opencode identity 사이6방향 private request·preview·수락·상관 result를 교환했다. 이 결과는 CLI/HTTP/MCP 프로토콜 검증이며 native discovery/모델 왕복 근거는 아래 별도 probe 범위와 구분한다.

2026-10-04 별도 installed Codex0.146.0 discovery probe: 임시 독립 CODEX_HOME에서 app-server initialize→initialized→skills/list(forceReload)만 호출해 프로젝트의 `.agents/skills/durebak/SKILL.md`가 단일 enabled skill로 발견됨을 확인했다. Credential을 복사하지 않았고 thread/model turn 생성은0회이며 기존 활성 session을 resume하지 않았다. 이는 해당 CLI의 비모델 skill discovery 근거다. Claude/OpenCode discovery 및 실제 native 모델 협업·identity isolation·자동깨우기는 여전히 미검증이다. [공식 app-server skills 계약](https://developers.openai.com/codex/app-server/)과 설치된 CLI generated schema에 근거했으며 installer의 native_host_verified:false는 전체 호스트 협업 검증을 대신하지 않는다는 뜻이다.


## schema11 개발: 내부 question 작업 예약

Read-only mock 경로에서만 사용할 내부 WorkReservations gate를 추가한다. Owner secret/epoch/instance·grant·source를 확인한 같은 transaction에서 attempt·전체 pending prefix 잠금·grant 및 요청 예산을 저장한다. 일반 receive는 예약된 메시지를 전달하지 않는다. 준비와 예약은 delivered_at/receipt/read/accept를 만들지 않으며 모델/Provider를 호출하지 않는다. 별도 SQLite connection의 수신 및 재접속에서도 예약이 보존된다.

총 turn은 durable grant scope에 연결하고 새로운 request나 off/on으로 초기화하지 않는다. Binding당 실행1개, workspace 예약/미확인 작업3개와 grant 한도를 검사한다. 제출 준비는 source/policy digest와 prefix 잠금을 재검증한 뒤 durable submitting으로 한 번만 전환한다. submitting replay는 submission_uncertain으로 거부하며 자동 재제출하지 않는다. Driver 접수·실행·결과 관측·interrupt·unknown reconciliation은 아직 없다. 취소된 예약의 자원 해제도 그 다음 gate에서 구현한다.

독립 리뷰에서 원래 grant의 continuation 예산 누락과 live waiter 없는 answer/result 실행 가능성을 발견했다. Request마다 새 grant scope를 만들지 않도록 보강하고, correlated waiter producer가 없는 이 단계에서는 answer/result 예약을 continuation_waiter_missing으로 명시적으로 차단한다. 완전한 result-prefix 원문 수집은 WorkInput에서 준비되지만 실행 권한을 뜻하지 않는다. Public CLI/HTTP/MCP에는 예약/제출 operation을 노출하지 않으며 auto_wake:false·host unverified를 유지한다.

기존 migration1–10 SQL은 유지하고 schema11을 추가한다. Alpha.6 immutable release는 schema10이며 이 개발 변경은 해당 release 파일이나 npm 지원 주장에 소급하지 않는다.

## schema12 개발: 모의 driver 접수·중단·재접속

내부 ExecutionController는 factory가 발급한 read-only mock만 사용한다. 구조가 같은 객체나 peer의 read-only 선언은 실행 근거가 아니다. Declared binding/profile/native ID·owner epoch/instance와 원문 digest를 검사하고 durable submitting 이후에만 mock submit을 호출한다. 실제 Provider·모델·네트워크 도구 호출은 없고 public CLI/HTTP/MCP operation은 추가하지 않는다.

접수 receipt는 attempt/epoch/instance/source digest/native turn ID와 연결한다. 입력 접수가 확인되면 전체 예약 prefix의 최초 전달과 audit를 같은 transaction에 기록한다. 메시지 상태 delivered는 read·request accepted와 구분하고 일반 receive로 재전달하지 않는다. Host turn succeeded는 요청 완료나 revision 검증 통과가 아니다. waiting_user는 소유권/동시 슬롯을 유지하고 자동 승인이나 다른 턴을 시작하지 않는다.

응답 유실·관측 불가·접수 후 DB 저장 실패는 durable intent를 유지해 unknown으로 격리한다. 재접속은 같은 attempt를 관측하며 새 submit을 하지 않는다. Known-unsubmitted reservation 또는 input-not-accepted 확인만 turn을 반환하고, 접수된 실행은 terminal 확인 후 동시 슬롯만 반환한다. 중복 관측은 예산을 반복 반환하지 않는다.

Policy off·session pause·request 취소/기한·grant 만료는 중단 의도를 먼저 저장하고 특정 mock attempt를 interrupt한다. Stop 요청/확인/unknown을 구분하고 unknown에서는 예산·단일 native owner fence를 유지한다. 중단 요청은 CAS로 한 번만 획득하고 재접속이 같은 interrupt를 자동 반복하지 않는다. Request timeout은 기존 task 취소 및 양쪽 control notice 계약을 공유한다.

독립 리뷰에서 관측·재시도 경로의 clock high-water 누락과 host busy 상태에서 기존 intent key 복구 실패를 발견했다. 실패 회귀 후 작업 진입·early rejection·replay·terminal receipt·응답 유실에서 durable owner/grant expiry를 관측하도록 수정했다. Owner lease 만료는 unknown을 유지하며 자동 갱신/인계하지 않는다. Deadline/만료는 clock rollback이나 peer read 부재로 부활하지 않는다.

Schema1–11 migration은 유지하고 schema12에 outcome/control 열만 추가한다. Living continuation·child provenance·actual native model wake와 지원 Provider 확대는 아직 별도 gate이며 answer/result reservation은 계속 차단한다. Alpha.6 immutable artifact(schema10)에 이 개발 내용을 소급하지 않는다.

## schema13 개발: 모의 하위 요청과 대기 중인 세션의 이어 실행

관리자 grant의 allowedPeers는 기본 빈 목록이며 같은 workspace의 명시적 상대만 허용한다. 실행 중이며 입력 접수가 확인된 mock attempt만 하위 요청을 만들 수 있다. 표준 요청·첨부·preview 검증과 execution origin 저장은 같은 transaction으로 처리하며, 일반 요청을 같은 key로 실행 lineage에 편입하지 않는다. 공유 원문은 명시적 하위 요청 내용뿐이며 부모 대화 전체를 복사하지 않는다.

하위 요청은 원래 root grant의 turn·동시 실행 예산을 공유하고 자기 실행 grant도 함께 차감한다. 부모/root 요청과 양쪽 grant보다 기한을 늘릴 수 없다. 명시적 root 취소·off·만료는 하위 실행에도 적용한다. Unknown 실행은 공유 예산·소유권을 유지하며 confirmed nonacceptance만 차감한 turn을 한 번 반환한다.

Trusted mock의 awaiting_peer receipt가 exact child origin을 가리키는 경우에만 완료된 host turn과 durable waiter를 함께 기록한다. 현재 binding/epoch/instance·grant digest·deadline에 맞는 answer/result만 waiter를 한 번 claim할 수 있다. 제출 전 현재 source/policy/원래 요청을 다시 확인한다. 응답 유실 후에는 같은 attempt를 관측하며 자동 재제출하거나 waiter를 복원하지 않는다. 대기 상태의 기한·취소 관측은 다음 작업 실패나 clock rollback 뒤에도 유지한다.

이 단계는 내부 mock controller 검증이며 공개 실행 operation, 실제 Provider model turn, 자동 wake scheduler, 기존 활성 native session resume를 추가하지 않는다. Cooperative Claude/Codex/OpenCode CLI·HTTP·MCP 및 공통 skill/command는 이전 범위를 유지한다. Schema1–12 migration은 유지하고 schema13을 추가한다. 기존 schema12 예약의 policy digest는 peer 허용 범위를 포함한 현재 digest와 다르므로 제출을 거부하고 재검증해야 한다. 기존 unknown/submitting은 새 작업으로 재제출하지 않는다. Immutable alpha.6(schema10) 파일에 개발 범위를 소급하지 않는다.

독립 리뷰에서 root peer 권한 철회·부모 일시정지 전 제출·중간 요청 취소 전파의 누락을 재현했다. 공유 provenance gate에서 직접 부모 및 root grant와 모든 요청 조상을 확인하도록 보강했고, 실패 재현4개와 continuation/reservation/driver55개를 다시 확인했다. Alpha.7은 schema13이며 실제 native wake/모델 협업 지원 주장은 추가하지 않는다.

## 실제 Codex 연결의 내부 RPC transport (개발)

CodexRpc는 newline JSON 메시지의 분할 UTF-8·여러 frame·동시 응답 ID를 처리하고 frame 크기·대기 요청 수·시간을 제한한다. Timeout/EOF/write 오류 뒤 자동 재송신하지 않는다. Host approval/tool request는 client response와 별도 namespace로 분리하고 기본 거부한다. Remote 오류는 숫자 code만 반환하며 원문 message/command/credential을 오류에 복사하지 않는다. 이 transport 자체는 native 실행 권한이나 durable attempt receipt 검증이 아니다.

설치된 Codex0.146.0의 기본 generated schema와 `--experimental` schema를 구분한다. 실험적 `permissions`/`permissionProfile`과 `activePermissionProfile`을 확인한 별도 비모델 probe에서 fresh isolated profile·ephemeral thread 생성/조회, explicit named profile 원문 읽기 허용·외부 원문/프로필 canary/symlink 읽기 거부·쓰기 거부를 확인했다. Credential 복사·model turn·기존 session resume는0이다. 동일 RPC 코드를 실제 initialize→thread/start→identity read→scoped command/exec에 적용해 확인했다. 이는 macOS installed-version 비모델 증거이며 실제 모델의 협업·read scope 및 Linux native 검증은 별도다.

[공식 permission profiles](https://learn.chatgpt.com/docs/permissions)와 [app-server 계약](https://learn.chatgpt.com/docs/app-server)은 beta 필드가 변경될 수 있음을 전제로 사용한다. Legacy readOnly 단독 정책은 실제 외부 canary 읽기를 허용했으므로 선택한 원문 범위를 증명하지 못한다. 현재 controller의 mock-only 권한과 auto_wake:false는 유지하며 canonical owned profile/machine-wide fence/actual turn·interrupt·재접속 및 scheduler 연결을 계속 구현한다. Immutable alpha.7 배포 파일에는 이후 개발 변경을 소급하지 않는다.


## Alpha.8: 내부 native profile 소유권 보호

NativeProfileFence는 private canonical profile에 durable owner metadata와 별도의 SQLite lifetime lock을 만든다. Native ID 저장 중에도 lock을 유지하므로 정상 상태 조회가 살아 있는 소유권을 해제하지 않는다. Lock 소유자를 확인할 수 없는 경우 unknown을 저장하며, metadata 저장이 다른 reader에 막히면 owned로 오인하지 않고 조회를 실패시킨다. 동시 상태 검사는 별도 inspection mutex로 직렬화해 다른 검사자의 잠금을 살아 있는 소유자로 오인하지 않는다. 기존 owner record는 자동 채택하지 않는다. Direct symlink(끝 slash 포함), 비공개가 아닌 권한, hardlink/비정규 owner 파일을 거부한다. 이 내부 helper는 실제 host readiness나 비협력 프로그램의 배제를 보장하지 않는다.

독립 process 강제 종료와 metadata commit 경쟁 조건을 회귀 검증했다. 설치된 Codex0.146.0의 격리된 비모델 probe에서 native thread identity 저장·소유권 조회·허용 원문 읽기·외부 canary 읽기 거부·host 종료 후 unknown을 확인했다. Credential 복사, model turn, 기존 session resume는0이다. Controller 연결·사용자 owned profile 인증·실제 모델 turn/interrupt/reconnect·자동 wake scheduler는 후속 gate이며 Cooperative 협업과 Managed/Attached 구분은 유지한다. Alpha.8은 schema13이고 alpha.7의 immutable artifact를 변경하지 않는다.

## Alpha.8 이후 개발: 내부 Codex native turn intent·관측

CodexTurns는 live NativeProfileFence의 canonical profile·native ID·epoch·instance와 같은 scope에 private SQLite ledger를 연결한다. 제출 전 prepared를 저장하고 health/auth 확인 후 조건부 submitting을 기록한 다음 turn/start를 한 번 호출한다. Prepared 중 취소는 known nonacceptance로 남아 모델 입력을 보내지 않는다. 접수 응답 대기 중 중단은 requested와 dispatched를 구분하고 exact turn ID가 도착하면 한 번 전송한다. Interrupt ACK 자체는 정지 근거가 아니며 exact interrupted terminal을 관측해야 stopped이다. 사용자가 host에서 직접 중단한 exact interrupted terminal도 host 실행 정지의 근거지만 Durebak 요청 완료·취소·검증을 뜻하지 않는다.

응답 유실·다른 thread/cwd/version·알 수 없는 turn은 unknown으로 남기고 새 turn이나 resume를 호출하지 않는다. 같은 live 소유권 안의 재연결은 저장된 정확한 turn ID만 thread/read(includeTurns)로 관측한다. Native owner 종료 이후의 takeover/restart 복구는 아직 별도 gate다. 원문은16KiB, profile-local intent는30개로 제한하며 ledger에는 source digest·identity·receipt만 저장한다. Terminal 관측은 이전 결과를 뒤집지 않는다. Configured permission ID는 provenance에 포함되지만 이 class 자체는 실제 tool isolation이나 host factory 신뢰를 증명하지 않는다.

건강 확인은 thread metadata와 account/read의 인증 존재만 반환하고 model entitlement는 unverified다. Installed Codex0.146.0의 새 thread는 아직 rollout history가 없어 includeTurns:true를 -32600으로 거부했다. Health에서는 includeTurns:false를 사용하고 실제 비모델 probe에서 auth:required 및 인증 누락 시 turn/start0회를 확인했다. Fake protocol 회귀는 접수·중단·known-turn 관측과 경쟁 조건을 검증하며 실제 모델 협업의 근거가 아니다. Controller authority는 mock-only이고 공개 실행 operation/auto_wake는 추가하지 않는다. Owned host factory·인증·실제 모델 tool scope/turn/interrupt/restart·scheduler 검증을 이어 진행한다. Immutable alpha.8 artifact는 변경하지 않는다.


## Alpha.9: 새 owned Codex host와 배포 분리

내부 startOwnedCodexHost는 명시적으로 지정한 실행 파일과 private canonical profile·빈 input directory를 검사한다. 정확한 named permission config와 owner fence를 확보한 후 installed0.146.0·fresh loaded state·effective config·새 persistent thread identity·선택한 permission·빈 instruction/MCP 범위를 확인한다. 비모델 command canary로 선택 원문 읽기 허용 및 외부/profile/symlink 읽기·쓰기 거부를 확인한 다음 같은 live owner의 CodexTurns에 연결한다. 기존 활성 session resume나 credential 복사, controller 권한 확대는 없다.

정상·비정상 종료 모두 즉시 native interface를 retire하고 owned process group에만 TERM/KILL을 전달한다. 부모 close 이벤트뿐 아니라 남은 group이 없음을 확인한 후에만 fence를 해제한다. 하위 프로세스가 pipe를 상속하거나 TERM을 무시하는 경우도 회귀 검증했다. 종료 불확실 상태에서는 fence를 유지하며 자동 takeover하지 않는다. Installed macOS Codex의 같은 factory 비모델 probe는 통과했지만 model entitlement·모든 model tool isolation·실제 협업/interrupt/restart는 별도 gate다. Controller는 mock-only, auto_wake:false를 유지한다.

Release workflow의 GitHub delivery와 npm publisher를 독립 job으로 분리했다. 두 경로 모두 동일한 CI pack과 checksum을 사용하며 Linux/macOS 검증·secret scan·installed smoke 이후에만 배포한다. npm 인증 실패가 검증된 GitHub artifact 배포를 막지 않으며, npm 게시 성공 여부는 registry bytes로 따로 확인한다. 이전 immutable alpha.8 artifact는 변경하지 않는다.

## Alpha.9 이후 개발: exact native 답변 원문

CodexTurns.readOutput은 접수가 확인된 exact native turn의 completed 상태에서 답변 하나만 선택한다. 명시적 final_answer가 없으면 한 개 phase-unknown agentMessage만 legacy fallback으로 표시하며, 복수 후보·중복 item identity·빈/64KiB 초과 답변은 거부한다. Commentary·reasoning·tool output·user input·다른 turn은 결과 원문으로 반환하지 않는다. Native 완료 상태는 Durebak 요청 완료나 independent verification과 구분한다.

Profile-local ledger v1→v2에 immutable 선택 답변/hash/item ID snapshot을 추가한다. 기존 source·turn receipt는 보존하고 같은 live owner 안의 재접속은 snapshot을 다시 수집하지 않는다. UTF-8 byte cursor와 페이지 상한을 적용하며, source identity 또는 owner가 달라지면 cached 원문도 읽지 못한다. Concurrent 첫 읽기의 출력이 다르면 최초 snapshot을 유지하고 충돌을 거부한다. 이 내부 원문 경로는 실제 모델 답변 검증과 선택 결과 전달의 기반이며 실제 모델 실행·native controller authority·자동 wake 지원을 추가하지 않는다. Immutable alpha.9 배포 파일에는 이후 변경을 소급하지 않는다.


## OpenCode native outcome observation (alpha.11)

`src/opencode-outcomes.ts` is an internal bounded message observation contract for OpenCode1.18.34. It requires the exact user message, session, assistant parent ID and selected provider/model. Provider errors take precedence over completed timestamps; abort ACK and session idle are not terminal evidence. Only a single completed non-summary `finish:stop` answer can supply bounded text and its SHA-256. Reasoning, ignored and synthetic text are excluded. Any tool-bearing success candidate is conservatively refused, including provider-executed/orphan exceptions not yet modeled; pending/running/completed tools cannot masquerade as final work. Ambiguous terminals, newer related messages, model fallback and foreign text parts fail closed. A native `MessageAbortedError` describes the message outcome, not confirmed process-tree termination or a Durebak request cancellation.

An isolated installed official1.18.34 non-model probe verified server health, Basic authentication rejection, fresh session reads and Durebak skill discovery from the alpha.10 installer. The synthetic-only free-model attempt was acknowledged but returned APIError403 with a completed timestamp; no actual model reply or model collaboration was verified. These observations do not activate native controller authority, automatic wake or Attached resume. These internal foundations are included in alpha.11; immutable alpha.10 release assets are unchanged.

Contracts: [OpenCode server](https://opencode.ai/docs/server/), [skills](https://opencode.ai/docs/skills/), [pinned official host source](https://github.com/anomalyco/opencode/tree/v1.18.34). HTTP transport ownership, durable submission/receipt ledger, OS tool scope, cancellation reconciliation and actual cross-provider model exchanges remain required gates.


`src/opencode-http.ts` adds an internal fixed normalized IPv4-loopback HTTP transport for OpenCode. It keeps Basic credentials in private memory, fixes the canonical input directory and exposes only selected health/config/provider/session/message routes. Model input is one exact message ID and plain text, without system instructions or arbitrary tools/routes. Bounded requests/responses, wall-clock deadlines, pending limits, strict UTF-8 and sanitized status errors reject unsafe or uncertain responses; redirects and POST retries are absent. A204 ACK does not establish model acceptance/completion, and abort boolean does not prove native work stopped.

The installed official1.18.34 fresh-server probe using this transport passed health, new-session exact reads, empty message history and idle abort ACK without model calls; the owned probe process group was confirmed gone. HTTP contact and Basic auth do not establish machine-wide ownership, OS tool scope or provider entitlement. Durable intent/receipt storage and verified owned-host/controller integration remain separate gates. Immutable alpha.10 deployment assets are unchanged.


## OpenCode durable turn intents (alpha.12)

`src/opencode-turns.ts` adds a private profile-local intent/receipt ledger under a live `NativeProfileFence`. Owner, binding, epoch, native session, canonical HTTP origin/directory and selected provider/model form an immutable scope. One active intent and at most30 retained attempts are admitted. Exact source hash and a native message ID are saved before health reads and POST; a204 ACK is separate from acceptance, which requires exact stored user text/model. Lost responses are observed using the same ID, never automatically re-posted. Reconnect is limited to the same live owner; ownership restart/takeover is absent.

Terminal answers are immutable bounded text/hash snapshots with owner/source identity and UTF-8 pagination. Errors outrank completed timestamps. Fresh unknown/foreign history cannot authorize acceptance or a session-wide abort. Cancellation before POST is known nonacceptance. After POST, cancel intent waits for an exact running assistant before spending a once-only abort:204 and user-message storage precede native runner registration and cannot prove it can be stopped yet. `observe` forwards a pending stop when running evidence appears. Abort ACK is not message-stop or process-tree termination. An in-flight or uncertain abort blocks every following submission even if the old turn completes; only a true native response settles that fence.

The installed official1.18.34 isolated non-model probe verified this ledger's health/session/history contact without model turns, credential copying or existing resume. Contact remains distinct from auth, entitlement and OS model-tool isolation. Fresh owned-host factory, controller integration, request deadline/revocation revalidation, actual model cancellation/continuation/reconnect and heterogeneous model exchange remain required gates; automatic native wake remains unverified. These internal foundations are included in alpha.12; immutable alpha.11 artifacts are unchanged.

Native scheduling evidence: [prompt_async](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts), [user storage and loop](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/session/prompt.ts), [runner registration and cancel](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/session/run-state.ts).


## OpenCode readiness gate (alpha.13)

The internal ledger checks health, exact session/history, configured provider/model and finally `/session/status` before recording submission. Busy/retry observations cause known nonacceptance and no POST; a previous terminal ledger result cannot override a busy native session. Missing selected models or connections also reject submission. Native status failures remain unknown. Cancellation requires both a matching unfinished assistant and fresh native busy/retry evidence; a stale unfinished message with an idle host cannot spend the once-only abort.

Readiness outputs distinguish contact, native state, model availability and configured connection. Provider connection presence does not establish authentication or entitlement: these remain unknown and unverified. Bounded parsing removes retry messages and provider configuration from returned observations. Instance-local idle omission requires exact session/history verification and cannot establish process exclusion. The installed official1.18.34 non-model probe passed these observations without model calls or existing-session resume.

Fresh owned-host startup remains a separate gate. Configuration and plugin initialization can run before the first effective-config response, and managed configuration can influence startup. Private XDG directories and post-start config inspection alone are insufficient evidence of OS isolation. Controller integration, model tool isolation, real cancellation and heterogeneous model exchange remain unverified; no automatic wake authority is added. Immutable alpha.12 assets are unchanged.

Sources: [session status](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/session/status.ts), [instance bootstrap](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/project/bootstrap.ts), [configuration](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/config/config.ts), [plugin initialization](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/plugin/index.ts).


## Pre-spawn bootstrap boundary (alpha.14)

`src/native-bootstrap-sandbox.ts` compiles an internal experimental macOS command using the installed, deprecated `sandbox-exec` interface. Explicit canonical private runtime/input roots and a separate private owner profile are checked before producing a policy. Writable trees and owner files must be owned regular files without symlinks or hardlink aliases; bounded tree traversal, parent count and policy size reject unsafe or excessive inputs. Root overlap and executable placement under writable/owner roots are rejected. The caller must control staging, exclude concurrent mutations and revalidate immediately before spawn: this is not an OS lease or native ownership proof.

The policy limits filesystem content to input/runtime, selected executable and explicit system/toolchain/timezone read exemptions. Ancestor directory literals permit listing, not descendant content. It grants one loopback inbound port without outbound networking. Special process-info and sysctl operations are explicitly denied before allowing self PID info, hardware and OS-release reads; deny-default alone did not block the reproduced kernel process-environment query. A generated unsigned C target receives only a synthetic marker: the same MIB call reads it outside the boundary and returns EPERM inside. No real process environment or credential is used for this check. macOS canaries also verify outside/owner/symlink access, outside writes, hardlink creation, descendant access and outbound socket denial, with positive input read/write and inbound contact controls. Unsupported execution platforms fail without an unsandboxed fallback; Linux CI verifies portable compiler contracts and skips the two macOS kernel canaries.

Installed official OpenCode1.18.34 consumed this compiled policy before a fresh server bootstrap. Health, Basic-auth rejection, effective deny-all/no-MCP/no-plugin configuration, fresh session/history/status, idle abort ACK, MCP/agent/OpenAPI observations and Durebak readiness contact passed without model calls, credential copies or existing-session resume. The owned probe process group was confirmed gone. Earlier narrower-prototype timeouts were retained as failed investigation results; they were not converted into verification success.

This helper only compiles a command. It does not spawn a host, filter inherited environment, create live ownership or grant model execution authority. Native auth storage, approved external provider network, all model-tool isolation, fresh owned-host/controller integration, deadline/revocation handling, actual cancellation/reconnect and heterogeneous model exchanges remain required. Automatic native wake is unverified. Immutable alpha.13 release assets are unchanged.

Primary references: [WebKit sandbox policy](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/WebProcess/com.apple.WebProcess.sb.in), [XNU process arguments](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sysctl.c), [numeric sysctl MAC checks](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_newsysctl.c), [pinned OpenCode build](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/script/build.ts). Installed kernel canaries are separate evidence from these source contracts.


## Fresh owned OpenCode host (alpha.15)

`src/opencode-owned-host.ts` claims a separate private owner fence and stages an empty private runtime/input before starting only a sandboxed official OpenCode1.18.34 host. A clean environment fixes private HOME, XDG config/data/cache/state, temporary and managed-config locations; ambient auth, workspace, auto-share and config variables are absent. Source-observed TEST_HOME and managed-config overrides are used as additional staging controls, not production isolation guarantees. The compiled OS boundary is revalidated immediately before detached spawn, before native global-config/plugin bootstrap. Linux execution explicitly refuses an unconfined fallback.

The factory chooses a nonzero loopback port, then waits for its owned child's exact listener announcement. It makes no authenticated HTTP request before that announcement and never polls a guessed pre-existing endpoint. The pinned Bun primary path uses reusePort:false and the clean environment excludes NODE_UNIQUE_ID, so a pre-existing simultaneous listener prevents the owned fixed-port bind. A listener collision, wrong/missing announcement, output bound or overall startup deadline retires the child. Metadata remains private and no Basic credential or raw transport is exposed. An announcement is not cryptographic peer authentication or an exclusive port lease: child death followed by foreign rebinding before a new connection remains a replacement race. This factory sends only its fresh bootstrap credential and fixed non-model metadata; resolving transport peer ownership before native credential provisioning or execution is an additional Managed authority gate.

Fresh session creation is a fixed HTTP operation: build agent, selected model `{id,providerID}`, one deny-all permission rule and a nonce marker; arbitrary permission/metadata/parent/workspace overrides are rejected. The marker alone is not ownership: the live fence, empty initial list/status, post-create exact-single scoped list and native identity, directory/version/model/agent/permissions/no foreign links, empty history and no foreign status/MCP are required together. Health repeats these scope checks, strips native data from readiness and retires the host on a conflict. Configured provider connection and available model remain auth unknown/entitlement unverified.

The host retires synchronously on leader exit/error and signals only its owned process group. Close waits for both group ESRCH and stdio close, escalates TERM to KILL when required, and retains the fence on persistent inspection uncertainty. Explicit close retry is supported; native history and an unknown owner are never automatically adopted. No model submission, raw transport or controller attachment is exposed by this bootstrap factory.

The installed checksum-verified official1.18.34 binary passed the built product factory: exact fresh session, ready/idle observation, separate owner claim and confirmed group disappearance, with model0/credential-copy0/existing-resume0. Initial Node ESM fixture startup failed because libc uname queries were denied and Node asserted; CommonJS fixture avoids that extra initialization without expanding the product policy. Descendant fixture spawn using ignore stdio failed EPERM on `/dev/null`; valid parent-opened pipes preserve the narrow boundary and exercise real group cleanup. These failures remain investigation evidence. Independent review found a foreign-session recheck gap; regression tests now reject foreign siblings at creation and during health.

Provider auth/network provisioning, all native model-tool scope, runtime-controller integration, request deadline/revocation forwarding, actual cancellation/reconnect and real heterogeneous model exchanges remain necessary before Managed/wake support. Immutable alpha.14 assets are unchanged.

Primary contracts: [serve listener](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/cli/cmd/serve.ts), [fixed-port server](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/server/server.ts), [session schema](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/session/session.ts), [permission rules](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/schema/src/v1/permission.ts), [auto-share](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/share/session.ts). Source contracts and installed non-model verification are distinct.

Listener source chain: [Bun primary reusePort:false](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/js/node/_http_server.ts), [primary environment selection](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/js/internal/cluster/isPrimary.ts). These source checks address simultaneous binding, not the later replacement race.


## Owned accepted TCP peer (alpha.16)

The OpenCode factory now connects without handing the socket to Node's HTTP Agent. Before HTTP headers or a body can be written, a parent-only compiled macOS helper verifies the direct child's UID, parent PID and immutable birth timestamp, plus possession of exactly one ESTABLISHED IPv4 loopback socket with the reverse server/client port tuple. Listener possession and an announcement alone are insufficient. The factory preserves the same paused TCP stream through verification and hands it to a request-local Agent only after success; every later connection is verified again. Linux refuses this native factory.

A TCP handshake can finish before Bun accepts the connection into its process FD table. Within a bounded window the factory repeats only read-only kernel inspection on the same stream, with no authentication bytes, reconnect or HTTP retry. Close, unexpected pre-authentication data, child departure, request deadline and verification deadline destroy the stream and prevent delayed grants. Actual kernel canaries reject unrelated PID, changed birth identity, listener-only and wrong tuples; a replacement process on the original port receives zero HTTP bytes. A delayed-accept canary succeeds on its original stream without sending data during inspection.

Compiler and inspector helpers run in separate owned process groups with bounded output and at most eight pending inspectors. Completion requires actual stdio close and group ESRCH, not merely a rejected exec callback. Persistent inspection uncertainty retains staging and cleanup ownership: NativePeerBuildError carries the inspector cleanup handle and OwnedOpencodeCleanupError carries the host close retry. An explicit retry may clean the same group; it never starts a replacement host. Private helper binaries are checked for canonical staging, UID, permissions, link count, size and digest before execution.

This check is an accepted-FD snapshot, not a proof that a process cannot inherit or transfer that FD. Keeping the same connected stream prevents a new listener from replacing the peer, but does not establish exclusive FD readership or model execution authority. Initial installed-host failures exposed the handshake/accept interval; stage diagnostics read only the owned child's numeric socket metadata. Debug copies are investigation evidence, not shipped-product proof. The built product factory then passed installed official1.18.34 fresh-session bootstrap, ready/idle observation and confirmed group disappearance, with model calls0, credential copies0 and existing resumes0. Provider authentication/network, native model/tool isolation, controller/deadline/cancel integration and heterogeneous model exchanges remain required gates. Immutable alpha.15 release assets are unchanged.

Primary contracts: [Apple process and socket metadata](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h), [Node asynchronous Agent connection](https://nodejs.org/api/http.html#agentcreateconnectionoptions-callback). These source contracts are distinct from installed-host verification.

## Native host retirement latch (alpha.17)

Codex and OpenCode owned hosts retain an observed process-group ESRCH for the lifetime of the host. Subsequent shutdown escalation and explicit cleanup retries never inspect or signal that numeric group again, because it may have been reused. Release still requires actual child stdio closure and helper cleanup. EPERM remains uncertain and retains the ownership fence. Regression tests cover inherited pipes, simulated numeric group reuse, explicit retry and persistent permission errors. This lifecycle fix confers no native model verification or automatic wake capability.

## Asynchronous controller readiness (alpha.18)

The internal mock-only execution controller now supports reserveAsync and awaits readiness before submission. Each readiness wait is bounded to five seconds; rejection or timeout blocks submission as host_unknown. Owner and time observations are repeated after the await, then the existing reservation/submission transaction validates current policy digests, source, lease, deadlines, delivery locks and attempt state. No transaction spans the readiness wait. Identical intent replay observes owner/time and returns the original attempt without another readiness probe. Concurrent execution of one reservation submits and records delivery once; cancellation during the wait prevents late submission. Synchronous mock reservation remains available and refuses unresolved readiness.

This establishes the asynchronous preflight contract required for later owned native adapters. Factory-only mock authority remains in force: this change does not connect native controller execution, authenticate a provider, verify model tools, or enable automatic wake.

## Codex observer retirement (alpha.19)

Codex turn-ledger connections now retire only intents they created. Closing a read-only observer or a connection whose submission was refused cannot cancel another connection's prepared input or replace its running receipt with unknown. The submitting connection still marks its own prepared input not_accepted and submitting/running input unknown when closed; late callbacks cannot record acceptance. No native interrupt, resume or replay is implied by closing a ledger connection. The host factory's ownership fence and process cleanup remain separate. This matches the existing OpenCode connection-local retirement contract and adds no model or automatic-wake authority.

## OpenCode observation ownership (alpha.20)

OpenCode observation and cancellation recheck the live driver and profile owner after awaiting the observation layer and before reading the ledger or returning an outcome. Even an already-resolved prepared or terminal read yields at the async boundary; driver close must reject with native_driver_closed, and owner loss must reject with native_owner_closed. Previously these races could read a closed SQLite connection or return a cached successful result after losing ownership. Regression tests cover driver/owner loss for prepared and terminal reads and preserve the durable state without extra submission or abort. This repair does not establish native controller/model authority or automatic wake.

## Private database adoption (alpha.21)

The runtime refuses a non-private or foreign-owner data directory and unsafe main DB/WAL/SHM/rollback journal files before SQLite opens. Each existing file must be regular, owned by the effective OS user, have a single hardlink and exclude group/other permissions. New sidecars are revalidated after WAL configuration before migration and after initialization; errors close the connection. Final directory symlinks with trailing slashes are rejected. Unsafe data is not automatically chmodded, chowned or deleted. Regression tests use synthetic local files and preserve outside targets while allowing normal private WAL reopening/concurrent connections. Same-OS-user adversarial isolation, elevated access and ACL-based grants are outside this POSIX startup check; API bearer/session/workspace authorization remains a separate boundary.

## Queue metadata polling (alpha.22)

Queue maintenance and status summaries select only the metadata required for expiry, retry and availability, avoiding unnecessary JavaScript message-body materialization. Delivery content and all authentication/transaction/file-protection gates remain unchanged. A deterministic real-SQLite payload-loading regression preserves counts and expiry while requiring zero body bytes on the polling path. A synthetic reproducible benchmark and the observed same-machine comparison are documented in PERFORMANCE.md; they do not establish general/provider latency or change native execution/wake support.

## Platform refusal and maintenance (alpha.23)

Storage requires an OS effective-user identity. Platforms without `process.geteuid` are refused with `unsupported_storage_platform` before directory or database creation. Existing data is left unchanged. This is an explicit unsupported-platform boundary, not a Windows ACL implementation. The separate Windows investigation and its sanitized report are described in [the probe guide](testing/windows-storage-probe.md); full Windows support remains pending. MCP SDK 1.32.1 is pinned, with no schema or protocol change.
