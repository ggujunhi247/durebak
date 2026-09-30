# 두레박 작업 안내

- 제품명은 두레박, 영문 브랜드는 Durebak, CLI·코드 식별자는 durebak이다.
- 첫 버전은 같은 컴퓨터의 Claude Code·Codex·OpenCode 세션 간 협업을 대상으로 한다.
- 현재 cooperative alpha CLI·HTTP·MCP가 구현되어 있다. docs/IMPLEMENTATION.md의 범위를 기준으로 하며 실제 Provider 호스트 실연동 검증과 구분한다.
- 문서 진입점은 README.md, 현재 기능 계약은 docs/IMPLEMENTATION.md와 docs/USAGE.md를 따른다.
- docs/ARCHITECTURE.md는 현재 구현 구조를 요약한다. 내부 계획·조사·작업 기록은 .durebak/private-docs/에 보관하고 공개 매뉴얼에서 참조하지 않는다.
- examples/review-loop.example.json은 실행 불가능한 설계 예제다. 확정된 런타임 설정으로 취급하지 않는다.
- Managed·Attached·Cooperative의 기능 차이를 유지한다. 기존 활성 세션을 임의로 중복 재개하지 않는다.
- 보내짐·읽음·수락·완료를 구분하고, 완료 근거는 최신 artifact revision에 연결한다.
- 한도·권한·사용자 중단·불확실한 실행 복구를 기능 설계에 포함한다.
- 새 공식 기능 주장은 해당 Provider의 1차 문서와 실제 검증 여부를 구분해 기록한다.
- 검증 명령: npm run check, npm test, npm run package:check. 동작 변경은 회귀 테스트로 검증한다.
- 공개 저장소에는 credential·사용자 경로·런타임 DB·실제 세션 대화를 넣지 않는다. 패키지 allowlist와 Apache-2.0을 유지하고 명시적 요청 없이 publish/push하지 않는다.
