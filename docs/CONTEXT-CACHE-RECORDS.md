# 토큰·캐시·기록 설계

> 구현 상태: cooperative alpha의 실제 지원 범위는 [구현 현황](IMPLEMENTATION.md)을 따른다. 이 문서의 자동 실행·고급 맥락 기능은 목표 설계다.
- 상태: 제품 스펙 v0.4.0의 설계 계약. 구현·절감률 검증 이전.
- 기본 범위: 같은 컴퓨터의 여러 세션. 기능 계약은 [제품 스펙](superpowers/specs/2026-09-29-durebak-design.md)과 함께 읽는다.
- 핵심 원칙: **기록은 충분히, 전달은 필요한 만큼, 재사용은 유효할 때만.**

## 1. 비용을 줄이는 순서

1. 필요 없는 모델 호출을 만들지 않는다. heartbeat, 대기 상태 확인, 수신 확인, 문서 렌더링은 런타임이 처리한다.
2. 같은 내용을 여러 세션에 반복 전달하지 않는다. 역할별 맥락 묶음과 변경분을 사용한다.
3. 로그·문서 전체 대신 요약과 revision/hash가 있는 참조를 전달한다.
4. 동일한 읽기·추출·요약 가공은 유효한 로컬 캐시로 재사용한다.
5. Provider가 지원하면 안정적인 prompt prefix의 재사용을 활용한다.
6. 입력·출력·요약·캐시 생성 비용까지 측정하고 품질 저하 여부를 함께 확인한다.

항상 세 에이전트를 호출할 필요는 없다. 사용자가 단일 작업이나 단순 질문을 요청하면 해당 세션만 실행할 수 있다. 사용자가 정한 독립 검토·검증 gate는 비용을 이유로 생략하지 않는다. 모델 변경·역할 축소는 미리 선택한 workflow 정책 안에서만 수행한다.

## 2. 공식 문서에서 확인한 경계

| 근거 | 확인한 내용 | 설계상 의미 |
|---|---|---|
| [OpenAI Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) | 동일한 prompt prefix의 처리 결과를 재사용하며 세션 유지만으로 cache hit가 보장되지 않음 | stable prefix를 유지하되 실제 usage로 적중 여부 측정 |
| [Claude Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | 정확히 일치하는 prefix가 필요하고 cache read/write 입력 사용량을 구분 | write 비용·수명·모델별 조건까지 고려; 다른 Provider와 KV 캐시 공유 가정 금지 |
| [Claude Code 비용 관리](https://code.claude.com/docs/en/costs) | 자동 caching/compaction, 도구 출력 전처리 등을 설명. compaction도 모델 요청 비용을 발생시킬 수 있음 | 매 턴 재요약을 피하고 host의 기존 기능과 중복 압축하지 않음 |
| [OpenCode Config](https://opencode.ai/docs/config/) | compaction auto/prune/reserved 설정을 문서화 | host가 수행한 압축·도구 결과 제거를 context epoch 변경으로 취급 |

조사일은 2026-09-29다. API 기능을 Codex·Claude Code·OpenCode 연결에서 직접 제어할 수 있다고 가정하지 않는다. CLI/SDK/계정/모델별 capability를 확인해야 한다. cache TTL과 요율은 고정 상수로 스펙에 복사하지 않는다.

Prompt cache는 새 답변 생성을 생략하는 결과 캐시가 아니다. 캐시된 입력도 모델이 다루는 맥락에 포함된다. 캐시 적중률, 실제 입력 크기, 청구 비용, 구독 한도는 서로 다른 지표다. 공급자가 다르면 토큰 산식과 한도 계산도 다를 수 있다.

## 3. 점진적으로 읽는 맥락

| 계층 | 내용 | 기본 전달 |
|---|---|---|
| 고정 규칙 | 역할, 협업 규약, 사용자 권한, 도구 스키마 | 세션 시작·정책 변경 시 |
| 작업 요약 | 목표, 현재 완료 기준, 미해결 항목, 다음 행동 | 새 작업·재개 시 |
| 변경분 | 새 finding, 변경 파일, 새 revision, 새 검증 결과 | 후속 턴 |
| 근거 원문 | 전체 diff, 로그, 문서, 과거 대화 일부 | 필요할 때 범위를 지정해 조회 |

각 맥락 묶음은 bundle ID, 수신 session/binding, context epoch, policy digest, source revision/hash 목록, base bundle ID, omitted 항목, 가공기 버전을 가진다. base를 알고 있다고 확인할 수 있을 때만 delta를 보낸다. compaction·clear·재시작·세션 교체 또는 인지 상태 불명 시 base를 무효화하고 짧은 전체 작업 요약과 원문 참조를 보낸다. 전달 확인은 모델이 내용을 이해하거나 영원히 기억한다는 보장이 아니다.

작업자는 요청·관련 코드·미해결 수정 사항을, 검토자는 기준·변경분·근거를, 검증자는 대상 revision·검증 절차·기대 동작을 우선 받는다. 다른 세션의 전체 대화와 내부 추론은 기본 입력에 포함하지 않는다. 검토자의 판단 독립성이 필요하면 다른 검토자의 결론을 먼저 주지 않는다.

### 기본 예산

- 자동 전달 맥락은 한 Provider 턴당 **2,000 추정 토큰을 목표**로 하고 **UTF-8 16 KiB 상한**을 기본으로 한다. 둘은 동치가 아니다.
- 상한은 두레박이 추가하는 작업 요약·learning·자동 도구 결과의 합계다. Provider 자체 system/history와 사용자가 직접 추가한 내용은 제어 범위 밖이며 별도로 측정한다.
- 자동 원문 확장 조회도 같은 턴의 예산에 포함한다. tool 호출마다 예산이 초기화되지 않는다.
- 현재 목표·필수 완료 기준·권한·미해결 차단 사유는 조용히 잘라 내지 않는다. 담을 수 없으면 작업 분할이나 명시적 정책 예산 변경이 필요하다.
- 원문 조회에는 revision과 section/line 범위를 요구하고 기본 응답은 4 KiB 이하다. `has_more`, 다음 cursor, 생략 여부를 반환한다. 원문 전체는 저장소에 보존한다.
- 모델 tokenizer가 있으면 버전을 고정해 계산하고, 없으면 추정값과 추정 방식을 표시한다. 한국어를 포함한 모든 텍스트를 bytes/4로 정확히 계산했다고 주장하지 않는다.

2,000 토큰은 초기 튜닝값이며 절감 성능 목표가 아니다. 이 값 때문에 검증 근거나 결함 정보가 누락되는지 회귀 시험한다. context window 여유를 알 수 없으면 자동 입력이 안전하게 들어간다고 보장하지 않는다.

## 4. 세 가지 캐시

### 4.1 Provider prompt cache

두레박이 제어할 수 있는 새 세션의 고정 규칙·도구 목록·출력 스키마 순서를 안정적으로 유지한다. 매번 바뀌는 시각·run ID·진행 상태는 고정 부분에 넣지 않는다. 기존 세션에서는 이전 history를 캐시 목적으로 재작성하지 않고 변경분을 덧붙인다.

어댑터는 `prompt_cache_control=host_managed|explicit|unsupported|unknown`, `cache_usage_reporting=full|partial|none`을 보고한다. explicit 설정은 지원이 확인된 경우만 전달한다. Provider가 관리하는 캐시를 다른 Provider나 계정으로 복사할 수 있다고 안내하지 않는다.

캐시 수명 연장을 위한 빈 모델 호출·주기적인 예열은 기본 off다. hit를 만들려고 불필요한 문장을 추가하지 않는다. 캐시를 유지하려고 완료된 세션을 계속 실행하지 않는다.

### 4.2 로컬 가공 캐시

대상은 변경 불가능한 자료의 읽기·텍스트 추출·검색 색인·결정적 요약·이미 생성된 요약이다. 로컬 cache hit는 재가공을 생략할 뿐, 해당 내용을 모델에 다시 전달할 때 입력 토큰이 사라지는 것은 아니다.

키는 workspace/접근 scope, source revision과 content hash, 가공기·템플릿 버전, 입력 옵션, 의존 자료 hash를 포함한다. 모델이 생성한 요약은 모델·관련 설정·prompt digest도 포함한다. 권한은 캐시 조회 시 다시 확인한다. 최초 캐시 키 생성에 사용한 권한이 계속 유효하다고 가정하지 않는다.

다음이면 재사용하지 않는다: 원문·의존성·정책·가공기 변경, 권한 철회, 손상, 출처 삭제, 의존성 목록을 확정할 수 없음. hash 확인이 기본이고 TTL만으로 정확성을 보장하지 않는다. 공유 프로젝트의 Git commit이 같아도 dirty working tree가 다르면 다른 입력이다.

### 4.3 작업 결과와 검증 근거

같은 request ID의 처리 결과 반환은 기존 idempotency 계약을 따른다. 일반 모델 답변의 유사도 기반 재사용, 수정·배포 같은 부작용 실행 생략, 오래된 검증 성공의 자동 승격은 v0.1에서 하지 않는다.

분석 결과를 참고로 다시 읽을 수는 있지만 현재 입력·정책과의 일치 여부를 표시한다. 최종 완료 gate는 현재 run의 최종 revision과 현재 정책을 대상으로 새로 수행한 필수 검증 evidence를 요구한다. 과거 evidence는 근거 탐색용이며 자동 통과 판정용이 아니다. 복구 시 현재 run에서 이미 확인된 동일 attempt evidence를 다시 사용하는 것은 중복 실행 방지에 해당한다.

## 5. 요약과 압축의 비용

먼저 구조화된 task/finding/evidence에서 규칙 기반으로 요약을 만든다. 긴 로그는 오류·변경 구간을 먼저 추출하고 원문 참조를 남긴다. 표나 결과 카드 생성에 LLM을 기본 사용하지 않는다.

LLM 요약은 기본 off이고 정책에서 허용한 경우에만 수행한다. 허용하더라도 작업 경계·실제 내용 변경·예산 압력에서 생성하고 매 메시지·heartbeat마다 다시 쓰지 않는다. source hash가 같으면 기존 요약을 재사용한다. 요약의 입력·출력 토큰, 시간, 실패·재시도도 workflow 예산과 사용량에 포함하며 Provider 턴 수에도 포함한다.

완료 기준, 실패 증거, 반대 의견, 미해결 항목을 보존해야 한다. 요약의 요약만 계속 덮어쓰지 않고 원본 revision을 참조한다. host가 compaction을 수행했다면 두레박은 이를 관측하고 base를 갱신하며, 별도 압축을 중복 실행하지 않는다.

요약의 예상 이득은 앞으로 절약할 실제 입력 비용에서 요약 생성·추가 조회·캐시 write·miss 비용을 뺀 값이다. 재사용 횟수를 알 수 없으면 이를 예측으로 표시한다. 작은 작업에서는 요약을 하지 않는 편이 저렴할 수 있다.

## 6. 기록을 남기는 네 층

| 기록 | 기준 저장소 | 용도 | 모델 기본 입력 |
|---|---|---|---|
| 이벤트와 원본 근거 | 로컬 DB + content-addressed artifact 저장 | 감사, 장애 복구, 사실 확인 | 참조만 |
| 현재 작업 상태 | 구조화된 task/checkpoint/finding | 어디까지 했는지와 다음 동작 | 관련 부분 |
| 결정 기록 | 채택된 decision revision | 선택·대안·이유·적용 범위 | 관련 결정 요약 |
| 재사용 지식 | accepted learning revision | 다음 작업에서 반복 실수 감소 | 관련 항목만 |

Markdown은 이 상태에서 만들어 내는 사람이 읽는 기록이다. 자동 생성한 Markdown을 다시 파싱해 runtime 상태를 덮어쓰지 않는다. 사용자가 수정한 결정 문서는 새 candidate revision으로 명시적으로 가져와 검토한다. 기존 사람이 작성한 제품 스펙·README는 생성기가 덮어쓰지 않는다.

### 저장 위치와 공개 범위

기본 데이터 root는 `DUREBAK_DATA_DIR`, 없으면 `$XDG_DATA_HOME/durebak`, 둘 다 없으면 `~/.local/share/durebak`이다. 한 daemon이 workspace ID별로 분리해 관리한다.

```text
<data-root>/
  runtime.sqlite
  artifacts/<workspace-id>/<content-hash>
  cache/<workspace-id>/<cache-key>
  records/<workspace-id>/runs/<run-id>/outcome.md
  records/<workspace-id>/decisions/<decision-id>/<revision>.md
  records/<workspace-id>/learnings/<learning-id>/<revision>.md
```

프로젝트에 공유하려면 명시적 export로 `docs/durebak/` 아래에 내보낸다. Git commit/push는 별도 사용자 작업이며 자동 수행하지 않는다. 원문 로그와 전체 대화는 기본 export에서 제외한다. 자격증명·개인 정보가 탐지되면 가리거나 제외하고, 자동 필터가 완벽하다고 보장하지 않는다.

생성 문서에는 record ID, schema version, source event watermark, artifact/policy digest, generated_at, generated_by, render hash를 남긴다. 변경은 tempfile+rename으로 원자적으로 반영한다. 사용자가 생성 파일을 바꿨으면 hash 불일치로 충돌을 표시하고 덮어쓰지 않는다. export 실패는 `export_pending`으로 표시하며 원래 run 성공 여부를 바꾸지 않는다.

### 문서 갱신 시점

run outcome은 작업 경계·중요한 차단·종료 때 구조화된 데이터로 렌더링한다. 토큰 스트림마다 파일을 다시 쓰지 않는다. 동일 watermark/digest의 재렌더링은 no-op이다. decision은 선택이 채택·변경됐을 때, learning은 후보 생성·채택·대체 시점에 기록한다.

색인은 ID·제목·적용 범위·상태·짧은 요약·출처로 구성하고 원문을 모두 연결해 자동 입력하지 않는다. 첫 버전 검색은 workspace 필터·태그·파일 경로·키워드/FTS부터 시작한다. embedding과 vector DB는 필수 의존성이 아니다. 검색 결과의 권한을 확인한 뒤 필요한 부분만 읽는다.

## 7. 유지·삭제·용량

로컬 가공 캐시는 기본 workspace별 256 MiB LRU다. 활성 읽기에 사용 중인 항목은 해당 읽기가 끝날 때까지 pin한다. 캐시는 삭제해도 원문에서 복구 가능해야 한다. artifact/evidence 원본과 accepted 결정·learning은 캐시 eviction 대상이 아니다.

종료된 run의 raw event 정리는 제품 스펙의 30일 보존 정책을 따른다. 활성 run 또는 보존 중인 outcome/decision/learning이 참조하는 원본 근거는 자동 삭제하지 않는다. 해당 근거의 보존을 해제하는 별도 작업이 있어야 삭제 후보가 된다. 저장소 용량 초과는 숨기지 않고 기존 storage_full 정책으로 새 실행을 중단한다.

캐시 삭제는 파생물만 제거한다. 원문 삭제를 요청하면 관련 캐시·색인·요약을 무효화하고 tombstone과 출처 누락을 표시한다. 필요한 검증 근거가 삭제되면 그 근거를 다시 성공 판정에 쓰지 않는다. 로컬 삭제가 Provider 측 history/cache까지 삭제한다는 의미는 아니다. 프로젝트로 내보낸 문서와 백업도 삭제 범위를 별도로 표시한다.

## 8. 측정과 출시 기준

사용량은 request/turn ID로 중복 제거하고 실제 모델 설정과 함께 기록한다. API가 제공하는 원본 usage를 보존하고 어댑터 버전별 정규화 규칙을 사용한다. input total, uncached input, cache-read, cache-write, output, reasoning 포함 관계를 명시한다. 이미 total에 포함된 값을 다시 더하지 않는다. 비용은 확인된 요율 버전과 알려진 항목으로 계산하며 구독 사용량을 현금 청구액으로 바꾸지 않는다.

측정 필드: 두레박 추가 입력 bytes/추정 tokens, Provider 실제 usage와 미제공 항목, cache read/write, 로컬 cache hit, 원문 확장 횟수, 요약 생성 비용, 문서 렌더링의 LLM 호출 수, 총시간, 품질 결과. cache hit만 높이고 출력 비용·재시도를 늘리는 최적화는 성공으로 보지 않는다.

평가는 같은 workflow의 (1) 전체 전달 기준선, (2) 변경분+참조, (3) 로컬 캐시 추가, (4) Provider 캐시 관측 가능 경로를 비교한다. 자연 cold/warm과 원문·정책 변경에 따른 무효화 사례를 분리한다. Provider 캐시를 강제로 비우거나 켤 수 없다면 그렇게 했다고 표시하지 않는다. 실행 순서와 설정을 기록하고 fixture별 최소 3회 비교한다.

필수 완료 기준과 알려진 결함 탐지율을 유지하는지 먼저 본다. 절감률은 측정 결과로 제시하며 특정 비율을 출시 약속으로 정하지 않는다. 비용·usage가 관측되지 않으면 payload 감소와 로컬 호출 생략만 보고한다.

## 9. 구현 범위

v0.1 필수: 역할별 bounded context, 원문 범위 조회, delta base 검증, 로컬 content-hash 캐시, 결정적 문서 렌더링, 기록 색인, usage provenance, 예산·품질 회귀 시험.

선택: host가 노출하는 Provider cache 제어와 보고, 정책으로 허용한 LLM 요약. 후속: 의미 유사도 기반 답변 캐시, vector 검색, 원격 공유 cache. 선택 기능을 지원하지 않아도 기본 통신과 기록은 동작해야 한다.
