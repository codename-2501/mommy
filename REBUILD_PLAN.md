# THE LOOKBACK — 순수 재구축 설계도 (REBUILD PLAN)

> **새 세션 시작법**: 이 파일을 읽고 "설계도 기준으로 재구축 시작"이라고 하면 Phase 0부터 진행.
> 작업 디렉토리: `C:\Users\enjoyworks\tlb-mine`  ·  서버: `python admin_server.py 8082` (dual-stack)
> **절대 규칙**: `taskkill //IM chrome.exe` 금지(사용자 브라우저 닫힘). 헤드리스는 `--user-data-dir` 격리 + 자체 종료.

## 목표
원본 사이트 https://tlb.betteroff.studio (Nuxt 클론)의 **구조·인터랙션·모션을 최대한 동일하게 재현**하되,
**데이터는 100% 우리 것**(Seung Eun 유화 195점, `content.json`)만 사용. 원본 브랜딩("Better Off"·"BO®S"·
원본 기사/카테고리) **전혀 없음**. 예외: 메뉴 아이콘의 Noun Project 크레딧(CC BY 3.0)만 유지.

### 왜 재구축인가 (클론 오버레이의 한계)
- 원본 워드마크·어바웃 문구가 **컴파일된 JS에 하드코딩/생성**돼 서버·클라이언트로 깔끔히 치환 불가.
- 클라이언트 오버라이드는 원본이 먼저 렌더돼 **플래시** + 글자 재구성이 **원본 퇴장 애니메이션을 깨뜨림**.
- → 원본 코드를 안 쓰고 새로 만들면 이 문제들이 근본적으로 사라짐.

## 재사용 vs 교체
**그대로 재사용 (건드리지 말 것):**
- `admin_server.py` — 정적 서빙 + 관리자 + API(`/api/content`, `/api/images`, `/api/upload`, `/api/aspects`).
  단, 홈(`/`)과 상세 라우팅을 **새 프론트엔드로 서빙**하도록 수정 필요(아래 Phase 0).
- `content.json` — 단일 데이터 소스(아래 데이터 모델).
- `admin/` — 관리자 패널(슬라이드 CRUD, 이미지, 텍스트, 로고 편집). 그대로 유지.
- `images/` — 업로드된 그림 파일. `icons/` — 메뉴 SVG(timeline/flow/collage/profile, Noun Project).

**새로 작성 (클론 대체):**
- 클론된 Nuxt 프론트엔드(`index.html`, `_nuxt/*`, `articles/*/index.html`) → **우리 프론트엔드로 교체**.
  - 새 프론트는 `site/` 디렉토리에 작성(`site/index.html`, `site/app.js`, `site/app.css`, `site/assets/`).
  - 원본 `_nuxt/*.css`, `articles/*/index.html`, `_payload.json`은 **스타일·구조·모션 참고용으로만** 사용(복사 X, 참조 O).

## 데이터 모델 (`content.json`)
```
{
  "slides": [
    { "id":"s0", "image":"/images/x.png",
      "top":"1",              // 순번 = 배열 순서(자동, 관리자에서 renumber)
      "bottom":"Inspire (January)",  // 카테고리(월) 라벨
      "category":"Inspire",   // 뱃지 카테고리(없으면 bottom 괄호 앞)
      "title":"작품명", "desc":"설명(문단 \n 구분)",
      "date":"2025-01-01",    // 연-월(타임라인 위치·눈금 연도). 없으면 자동 내림차순 2026
      "media":[               // 상세의 이미지/영상 (본문 교차 배치)
        {"type":"image","src":"/images/a.png","caption":"","pos":0,"align":"center"},
        {"type":"video","videoId":"abc","caption":"","align":"right"}
        // pos: 0=글 위, k=문단 k 뒤, 없음=글 아래 / align: left|center|right(종횡비 유지)
      ]
    }
  ],
  "wordmark": {"l1":"LSE GALLERY","l2":"THE LOOKBACK","l3":"(SE/2026)"},  // 로고 3줄(우리 것)
  "texts": { "/about": {"원본문구":"우리문구"} }   // 페이지별 텍스트 오버라이드
}
```
- 월별 집계: `bottom`의 `(Month)`에서 추출. 연도: `date`에서. (관리자에서 편집)
- `/api/aspects` : PIL로 이미지 종횡비 반환(썸네일 자연비율용).

## 페이지/뷰 (모두 재현)
1. **인트로 게이트** (`/` 첫 진입): 
   - 대형 워드마크 3줄(우리 wordmark, 글자별 등장 애니메이션).
   - 우측 월별 리스트: 각 월 + 우리 작품 수 `INSPIRE (N)` (2컬럼 grid, Jan~Jul / Aug~Dec).
   - "Enter with sound →" / "…or without" 게이트. 진입 시 퇴장 애니메이션.
2. **홈 / 타임라인** (진입 후): 
   - 가로 캐러셀: 그림들 자연 종횡비, 가로 드래그/스크롤·스냅.
   - 상단 타임라인 눈금(월 라벨 + 연도, `date` 기반, 위아래 반전 배치 — 현재 원본 클론에서 적용한 스타일).
   - 하단 중앙 **프로스트글래스 메뉴**: 뷰 아이콘 3개(timeline/flow/collage) 캡슐 + **About(profile) 별도 원형 버튼**. 진입 시 하단→위 슬라이드업.
3. **상세** (그림 클릭): 
   - 좌: prev/current/next 이미지 strip(순번, 클릭 이동). 우: 뱃지(카테고리)·제목·본문·미디어(이미지/영상 grid, pos 교차배치, align 좌/중/우).
   - 클릭→상세 **플립/전환 모션**, 다른 이미지로 이동, Close로 복귀. 무플래시.
4. **Surf** (`/surf`): flow(흐름) 레이아웃 대체 보기. **Index** (`/articles`): collage/grid 목록. **About** (`/about`): 소개 + (하단에 Noun Project 아이콘 크레딧).

## 재현할 인터랙션/모션
- 인트로: 워드마크 글자 stagger 등장, 게이트 클릭 → 부드러운 퇴장(현재 원본이 하는 느낌).
- 캐러셀: 가로 드래그 관성/스냅, 눈금과 동기화, 그림 위치 상단 정렬.
- 클릭 → 상세: 그림이 확대/플립되며 상세로 전환(원본의 native flip 느낌).
- 상세 strip: prev/current/next, 클릭 시 시퀀스 이동.
- 메뉴: 인트로 중 숨김(하단), 진입 시 슬라이드업. 뷰 아이콘 active 상태.
- 미디어 정렬(좌/중/우, 종횡비 유지), 본문 교차 배치(pos).

## 기술 접근
- **Vanilla JS + CSS** (프레임워크 없음, 오프라인 자립 — CDN 금지). 애니메이션: CSS transition/keyframe + Web Animations API. 필요 시 경량 라이브러리는 **벤더링**(다운로드해서 로컬 포함).
- SPA 라우팅(간단한 history API) 또는 멀티페이지. 상세는 `/#/painting/<id>` 또는 서버 라우트.
- `admin_server.py`가 `site/` 정적 파일을 서빙하도록 라우팅 추가. `content.json`은 `/api/content`로 fetch.
- 폰트: 원본 폰트 확인 후(아래 참고자료) 동일/유사 폰트 로컬 포함. 색: 기본 흑/백(원본 = 흰 배경·검정 텍스트).

## 참고 자료 (디스크에 있음 — 스타일·구조 추출용)
- 원본 스타일: `_nuxt/*.css` (Tailwind 기반; `default.BeBKBVc8.css`가 메인). 클래스별 실제 스타일 참고.
- 원본 구조/모션: `articles/<slug>/index.html` (프리렌더 SSR DOM), `articles/<slug>/_payload.json`.
- 원본 홈 구조: 서버 실행 후 `curl http://localhost:8082/`(단, 이건 클론이므로 새 프론트로 교체 예정).
- 폰트 파일: `_nuxt/`에 woff2 없으면 원본 HTML `<link>`/`@font-face`에서 폰트명 확인 후 동등 폰트 사용.
- 이전 클론에서 파악한 사실: 워드마크는 글자별 `div`(js-r*-s*-l), 눈금 `.js-t-fade .label`, 캐러셀 `.carousel__slides article`, 메뉴 header에 `mix-blend-mode:difference`(새 빌드에선 불필요).

## 단계별 계획 (Phase)
- **Phase 0 — 스캐폴드**: `site/` 생성(index.html/app.js/app.css). `admin_server.py`가 `/`·상세를 `site/`로 서빙(클론은 `/_legacy/`로 보존). `content.json` fetch 확인. 빈 화면 + 라우팅.
- **Phase 1 — 인트로 게이트**: 워드마크(3줄, 글자 stagger), 월별 리스트(우리 집계), Enter 게이트 + 진입/퇴장 모션.
- **Phase 2 — 홈/캐러셀/메뉴**: 가로 캐러셀(드래그·스냅·자연비율), 상단 눈금(월+연도), 프로스트 메뉴(3뷰+About 분리, 슬라이드업).
- **Phase 3 — 상세**: 클릭→플립 전환, strip(prev/current/next), 미디어 grid(pos 교차·align 좌/중/우), Close.
- **Phase 4 — Surf/Index/About**: 대체 뷰 레이아웃 + About + 아이콘 크레딧.
- **Phase 5 — 폴리시**: 애니메이션 타이밍, 반응형, 접근성, 성능. 관리자와 왕복 검증(편집→반영).
- 각 Phase 후 헤드리스(격리 프로필) 스크린샷 검증. **50% 컨텍스트 규칙**: 한 세션에 1~2 Phase씩.

## 완료 기준
- 화면 어디에도 원본 브랜딩/데이터 없음(SVG 크레딧만).
- 인트로·캐러셀·상세·메뉴 모션이 원본 느낌으로 동작, 플래시/끊김 없음.
- 관리자에서 편집한 내용(슬라이드·로고·미디어·정렬·날짜)이 그대로 반영.
- 깃헙 `codename-2501/mommy`에 커밋.
