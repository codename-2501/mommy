# THE LOOKBACK — with my paintings + full admin CMS

The real cloned THE LOOKBACK site (original Nuxt app: real carousel, intro
animation, wordmark blend) with local paintings, plus a local admin CMS to
manage everything.

## Run
- Double-click **`start-admin.bat`**
- or: `python admin_server.py 8082`
  - Site:  http://localhost:8082/
  - Admin: http://localhost:8082/admin/

## Admin (/admin/) — three tabs

**슬라이드 (Slides) — full CRUD**
- 추가 / 복제 / 삭제 / 순서변경(드래그 또는 ↑↓)
- 이미지 변경(썸네일 클릭 → 라이브러리), 위·아래 문구 편집
- 검색, 표시분 아래문구 일괄변경

**이미지 (Images) — CRUD**
- 업로드(여러 장), 삭제(사용 중이면 확인), 슬라이드별 사용 수 표시

**텍스트 (Text) — 전체 페이지**
- 페이지 선택(홈/about/surf/articles + 각 아티클) → 그 페이지의 문구를 스캔해 편집
- 원본 문구 옆에서 수정, 같은 문구는 모두 반영

저장(또는 Ctrl+S) → `content.json` 기록 → 사이트 새로고침 시 반영.

## How it works (non-destructive)
- `content.json` = single source of truth (slides ordered array + per-page texts).
- `admin_server.py` serves the site + admin + JSON API, and injects `tlb-admin.js`.
- `tlb-admin.js` reconciles the carousel (create/update/delete/reorder via a
  cloned template + a dispatched resize so the compiled carousel recomputes)
  and applies per-page text overrides — all AFTER hydration, so the original
  compiled site is never modified on disk and can't break.

### Note on brand-new slides
Added slides display and scroll (carousel bounds recompute on resize), but their
flip/hover micro-animation may be imperfect since the compiled GSAP wires those
at load. Editing / deleting / reordering existing slides is fully faithful.

## API
- `GET/POST /api/content` · `GET /api/images` · `POST /api/upload?name=` ·
  `DELETE /api/images?name=[&force=1]` · `GET /api/pages` · `GET /api/textscan?path=`

## Files
- `admin_server.py`, `admin/index.html`, `tlb-admin.js`, `content.json`
- `swap_images.py` — one-time original→painting image bake (already applied)
