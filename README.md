# 톡톡 — AI 음성 주문 키오스크

**톡** 누르는 터치와 **Talk** 대화를 함께 사용하는 한국어 카페 주문 MVP입니다.
말하거나 메뉴를 눌러 주문하고, 잔별 옵션과 장바구니를 확인·수정한 뒤
화면에서 최종 확인하면 **모의 주문번호**를 받습니다. 승인된 직원은 별도
화면에서 주문 제작 상태를 관리합니다.

> 결제·POS·실제 매장 운영 연동은 없습니다. 이 저장소는 아이디어 해커톤용
> 주문 시연 앱, API, 발표 덱, 데모·홍보 영상, 디자인 샌드박스를 묶은
> **pnpm 모노레포**입니다. 소스 공개는 서비스 배포가 아니며,
> 다른 호스팅이나 운영체제에서의 실행을 보장하지 않습니다.

## 프로젝트 구성

| 경로 | 역할 | Replit 미리보기 경로 |
| --- | --- | --- |
| `artifacts/voice-kiosk/` | React 키오스크와 직원 화면 | `/`, 직원 `/staff` |
| `artifacts/api-server/` | Express API, 메뉴·주문·음성 처리 | `/api` |
| `artifacts/voice-kiosk-deck/` | 편집 가능한 한국어 발표 덱 | `/voice-kiosk-deck/` |
| `artifacts/voice-kiosk-demo/` | React 기반 서비스 데모 영상 | `/voice-kiosk-demo/` |
| `artifacts/voice-kiosk-promo/` | 톡톡 홍보 영상 | `/voice-kiosk-promo/` |
| `artifacts/mockup-sandbox/` | 디자인 컴포넌트 미리보기 | `/__mockup` |
| `lib/api-spec/` | OpenAPI 계약과 코드 생성 설정 | — |
| `lib/api-client-react/`, `lib/api-zod/` | 생성된 클라이언트·검증 스키마 | — |
| `lib/db/` | PostgreSQL 접근, Drizzle DB 스키마 | — |
| `scripts/` | 작업공간 유틸리티·개발용 병합 후 설정 | — |
| `docs/` | 음성 품질 검증 절차와 분석 이벤트 안내 | — |
| `attached_assets/video-sources/` | 제품 화면의 원본 이미지 | — |

각 아티팩트의 `public/`에 필요한 이미지·배경음악·짧은 영상이 포함됩니다.
발표 문구·디자인 방향·영상 시나리오도 각 아티팩트에 남겨 두었습니다.
PDF/PPTX와 루트의 완성 MP4 내보내기 파일은 포함하지 않습니다.
영상 아티팩트는 원본 영상 편집기가 아니라 브라우저에서 재생하는 React 영상입니다.

## 개발 환경과 설치

- 기존 Replit 설정: **Node.js 24**, Python 3.13, PostgreSQL 16.
- 준비 검증에 사용하는 패키지 관리자: **pnpm 10.26.1**.
- Git과 `pnpm-lock.yaml`을 사용합니다. npm/yarn 설치는 루트의 사전 설치
  스크립트가 거부합니다. Python은 공개본 복사 도구에만 필요합니다.
- 현재 잠금 파일과 네이티브 패키지 제외 설정은 Replit의 Linux x64 환경을
  기준으로 합니다. macOS·Windows·다른 CPU에서의 설치·실행은 미검증입니다.

```sh
pnpm install --frozen-lockfile

# 공용 라이브러리 선언 파일 생성 및 검사
pnpm run typecheck:libs

# 주요 제품 검사
pnpm --filter @workspace/api-server --filter @workspace/voice-kiosk run typecheck

# 전체 검사: 아래 '검증 범위와 알려진 한계'를 먼저 읽으세요.
pnpm run typecheck
```

설치 오류가 나면 원인을 확인하세요. `--frozen-lockfile` 실패를 무조건
잠금 파일 재생성으로 숨기지 마세요. 루트 `build`는 전체 타입 검사를 먼저
실행하며, 프런트 빌드는 서비스별 `PORT`·`BASE_PATH`도 필요합니다.

## Replit에서 실행하기

1. 저장소를 Replit 프로젝트로 가져온 뒤 `.replit`과 여섯 개
   `.replit-artifact/artifact.toml`의 구성이 유지됐는지 확인합니다.
2. PostgreSQL 개발 DB를 준비하고 필요한 변수는 **Secrets**에서 설정합니다.
   `.env.example`은 이름과 용도 안내이며 실제 값을 포함하지 않습니다.
   현재 실행 스크립트는 루트 `.env`를 자동으로 읽지 않습니다.
3. **새로 만든 개발 DB**에만 스키마를 검토해 적용합니다:
   `pnpm --filter @workspace/db run push`.
   실제 고객 데이터가 있는 DB나 운영 DB에 이 명령을 적용하지 마세요.
4. 아티팩트에 연결된 실행 흐름을 사용합니다. API와 키오스크를 함께
   실행하고 Replit의 미리보기에서 엽니다. 루트에는 `pnpm dev`가 없습니다.

| 실행 흐름 | 내부 명령 | 포트 / 기본 경로 |
| --- | --- | --- |
| `artifacts/api-server: API Server` | `pnpm --filter @workspace/api-server run dev` | `8080` / `/api` |
| `artifacts/voice-kiosk: web` | `pnpm --filter @workspace/voice-kiosk run dev` | `24160` / `/` |
| `artifacts/voice-kiosk-deck: web` | `pnpm --filter @workspace/voice-kiosk-deck run dev` | `24219` / `/voice-kiosk-deck/` |
| `artifacts/voice-kiosk-demo: web` | `pnpm --filter @workspace/voice-kiosk-demo run dev` | `25292` / `/voice-kiosk-demo/` |
| `artifacts/voice-kiosk-promo: web` | `pnpm --filter @workspace/voice-kiosk-promo run dev` | `23010` / `/voice-kiosk-promo/` |
| `artifacts/mockup-sandbox: Component Preview Server` | `pnpm --filter @workspace/mockup-sandbox run dev` | `8081` / `/__mockup` |

Replit의 아티팩트 실행 흐름은 서비스별 환경 변수와 경로 기반 프록시를
설정합니다. 프런트는 같은 도메인의 `/api`를 사용하며, 단순히 Vite 포트만
열거나 하나의 전역 `PORT`를 설정하는 것만으로 같은 구성이 되지 않습니다.
외부 호스팅용 프록시·인증·환경 구성의 포팅은 이 공개 작업에 포함되지 않습니다.
마이크는 HTTPS와 브라우저 권한이 필요합니다.

**병합 후 설정 주의:** `.replit`의 `postMerge`는
`scripts/post-merge.sh`를 가리킵니다. 이 스크립트는 의존성 설치,
주요 타입 검사에 이어 **`push-force`로 개발 DB 스키마를 변경**합니다.
운영 DB를 연결한 환경에서는 실행하지 마세요. 이번 공개 준비에서는
이 스크립트를 실행하거나 DB 스키마·운영 데이터를 복사하지 않습니다.

## 환경 변수와 외부 서비스

| 이름 | 용도·노출 범위 |
| --- | --- |
| `DATABASE_URL` | **서버 전용**, PostgreSQL 연결. Replit DB 설정 후 제공됩니다. 주문 저장에 필수 |
| `OPENAI_API_KEY` | **서버 전용 비밀키**. 음성 전사·주문 해석·안내 음성에 필요. 터치 주문에는 불필요 |
| `OPENAI_TRANSCRIPTION_MODEL` | 서버 모델 선택, 기본 `gpt-4o-transcribe` |
| `OPENAI_ORDER_MODEL` | 서버 모델 선택, 기본 `gpt-5-mini` |
| `CLERK_SECRET_KEY` | **서버 전용 비밀키**, 직원 인증 |
| `CLERK_PUBLISHABLE_KEY` | API의 Clerk 공개 키 설정. 비밀키와는 다름 |
| `VITE_CLERK_PUBLISHABLE_KEY` | 프런트에 노출 가능한 Clerk 공개 키. 직원 화면에서 사용 |
| `VITE_CLERK_PROXY_URL` | 선택적 운영 Clerk 프록시 URL. 프런트에 노출되므로 인증 정보는 넣지 않음 |
| `PORT`, `BASE_PATH` | Replit 실행 흐름의 서비스별 포트·기본 경로 |
| `NODE_ENV`, `LOG_LEVEL` | 실행 환경과 서버 로그 수준 |
| `REPL_ID`, `REPLIT_DEV_DOMAIN` | Replit 제공 값. 개발 도구·검증에서 사용하며 직접 복사하지 않음 |

안내 음성 모델은 현재 코드에서 `gpt-4o-mini-tts`로 고정됩니다.
`SESSION_SECRET`은 현재 소스에서 사용하지 않으므로 별도로 요구하지 않습니다.
`VITE_` 변수는 브라우저에 공개됩니다. OpenAI·Clerk 비밀키와 DB 연결 정보를
절대 넣지 마세요. 키·DB 데이터·직원 계정·권한은 저장소에 포함되지 않습니다.

### 직원 인증과 승인

고객 키오스크는 익명이며 Clerk 로그인이 필요 없습니다. `/staff`에서만
Replit 관리 Clerk 인증을 사용하고, 로그인 후에도 DB의 활성 직원 승인이
있어야 주문에 접근할 수 있습니다. 가입이나 이메일 도메인만으로 권한이 생기지 않습니다.

신뢰된 운영자가 **개발 환경의 계정 ID**를 확인하고 실행합니다:

```sh
pnpm --filter @workspace/api-server staff:access grant <Clerk-user-id>
pnpm --filter @workspace/api-server staff:access revoke <Clerk-user-id>
```

개발·운영 인증 계정과 DB 권한은 별도입니다. 개발 승인은 운영 승인으로
복사되지 않습니다. 다른 프로젝트로 가져왔을 때 기존 인증 테넌트가
자동으로 연결된다고 가정하지 마세요. 현재 주문 큐는 단일 카페용입니다.

## 테스트와 API 계약

```sh
# 외부 AI 호출 없는 결정적 API 테스트.
# 일부는 설정된 개발 DB에 테스트 행을 생성하고 자기 행만 정리합니다.
# 준비된 개발 DB에서만 실행하며 운영 DB에서는 실행하지 마세요.
pnpm --filter @workspace/api-server run test

# 실제 마이크·고객 음성 없는 브라우저 로직 테스트
pnpm --filter @workspace/voice-kiosk run test:recorder
pnpm --filter @workspace/voice-kiosk run test:menu
pnpm --filter @workspace/voice-kiosk run test:speech
pnpm --filter @workspace/voice-kiosk run test:analytics

# API 계약 변경 시에만 생성 (생성 파일은 저장소에 이미 포함됨)
pnpm --filter @workspace/api-spec run codegen
```

`test:ai`, `test:preferences`, `test:stt`, API의 `test:speech`,
`test:quality:text`, `test:quality:voice`는 **별도 신청하는 실제 AI 검사**이며
OpenAI 사용량을 소비합니다. 이번 공개 준비에서는 실행하지 않습니다.
음성 평가 동의·보관 규칙과 실제 기기 검증 한계는
[`docs/voice-quality/README.md`](docs/voice-quality/README.md)를 참조하세요.
과거 품질 결과는 현재 공개본의 신규 성능 보증이 아닙니다.

### 검증 범위와 알려진 한계

이번 준비 검사에서 데모·홍보 영상에 DOM 타입 누락(`window`, `document`,
미디어 요소)과 애니메이션 `Variant` 타입 오류가 확인됐습니다.
전체 `pnpm run typecheck`는 실패하며 이에 의존하는 루트 `build`도
통과를 보장하지 않습니다. 이번 공개 작업은 기존 영상 코드 문제를 수정하지 않습니다.
준비 검증의 실제 성공·실패는 [`docs/public-release.md`](docs/public-release.md)에
구분해 기록합니다. 설치·타입 검사·단위 테스트는 실제 마이크, 매장 소음,
지역 발화, 결제, 외부 호스팅이나 운영 적합성 검증의 대체물이 아닙니다.

## 데이터와 MVP 범위

- 메뉴·가격은 API의 JSON 카탈로그가 기준입니다. AI 결과는 서버에서 재검증합니다.
- 불명확한 주문은 질문하며, 고객이 말하지 않은 옵션이나 수정 대상을 추측하지 않습니다.
- 최종 확정은 고객의 터치가 필요합니다. 실제 결제는 없습니다.
- 녹음은 요청 메모리에서만 처리하고 파일로 보관하지 않습니다. 전사·대화는
  임시 PostgreSQL 세션에서 처리되며 확정·취소·만료 시 정리됩니다.
- 확정된 모의 주문은 DB에 남습니다. DB가 없거나 저장이 실패하면 성공으로
  위장하거나 메모리 저장으로 대체하지 않습니다. 공개 저장소에는 **스키마만**
  있으며 주문·직원·고객 데이터는 없습니다.
- 여러 화자의 실제 식별, 겹친 목소리 감지, WebSocket 스트리밍,
  다중 매장 격리와 실매장 소음·사투리·실기기 품질 보증은 없습니다.
- OpenAI로 전송된 데이터의 보관·처리는 공급자 약관을 따르며,
  앱이 녹음을 저장하지 않는다는 말이 공급자의 무보관을 보장하지 않습니다.

## 공개 범위와 이후 변경

공개본은 **현재 파일로 시작하는 새 Git 이력**입니다. 원본 Replit 작업 이력과
실험·백업 브랜치는 업로드하지 않습니다. 내부 에이전트 문서, 붙여넣은
기획 자료, 루트 완성 영상, 생성물과 비공개 평가 자료는 원본에 보존하되
공개본에서는 제외합니다.

`.gitignore`를 추가해도 이미 추적된 파일과 과거 이력은 지워지지 않습니다.
원본 작업공간에서 그대로 `push --all`·`push --mirror` 하지 마세요.
별도 공개본은 다음 명령으로 새 폴더에 만들 수 있습니다:

```sh
python scripts/export-public.py generated-artifacts/public-source
```

이 도구는 `.public-exportignore`와 Git 제외 규칙을 적용하고 필요한 구성의
누락·민감 파일명·일부 비밀키 패턴을 검사합니다. Git 저장소 생성·업로드는
하지 않습니다. 자동 검사는 개인정보·저작권·숨은 비밀값의 완전한 검증이
아니므로 실제 업로드 전 사람이 공개 목록과 파일 내용을 확인해야 합니다.
새 기능을 공개 저장소에 반영할 때도 기존 이력을 무작정 덮어쓰지 말고
검토한 변경만 추가하세요. 실제 고객 녹음·DB 덤프는 어떤 공개 경로에도 넣지 마세요.

별도 라이선스 파일을 새로 부여하지 않았습니다. 기존 `package.json`의
`license: MIT` 표시는 변경하지 않았으며, 공개 에셋·음악·글꼴·라이브러리의
재사용 권리까지 일괄 보증하는 뜻은 아닙니다.
