# 작업 결과: {{title}}

<!-- Design template; not an executed run. -->

| 메타데이터 | 값 |
|---|---|
| record/schema | {{record_id}} / {{schema_version}} |
| run/상태 | {{run_id}} / {{status}} |
| 원본 watermark | {{source_event_watermark}} |
| 산출물/정책 | {{artifact_revision}} / {{policy_digest}} |
| 생성 주체/시각/hash | {{generated_by}} / {{generated_at}} / {{render_hash}} |

## 결과

{{short_outcome_and_reason}}

## 완료 기준과 근거

| 기준 | 통과·실패·미확인 | evidence ID |
|---|---|---|
| {{criterion_id}} | {{verdict}} | {{evidence_id}} |

## 변경과 남은 문제

{{changes_and_unresolved_findings}}

## 사용량

{{observed_usage_estimates_unknowns_summary_cost_and_stop_status}}

## 다음 동작

{{next_action_or_none}}

원문은 immutable revision/evidence ID로 조회한다. 이 문서의 요약 자체를 테스트 실행 근거로 사용하지 않는다.
