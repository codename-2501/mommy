# LSE GALLERY — 회화 아카이브 + 로컬 관리자

승은(Seung Eun)의 유화 작업을 월별 타임라인으로 보여주는 정적 사이트와, 그 콘텐츠를
로컬에서 편집하는 관리자 패널입니다. 외부 CMS 없이 `content.json` 하나로 굴러갑니다.

## 실행
```
pip install pillow          # 썸네일/종횡비 (유일한 의존성)
python3 admin_server.py 8082
```
- 사이트: http://localhost:8082/
- 관리자: http://localhost:8082/admin/ — **로컬 전용**. 터널 등 외부 접근에는 404 로 응답하고,
  저장·업로드·삭제 API 도 외부에서는 403 입니다.

## 뷰
- **타임라인** `/` — 가로 캐러셀 + 상단 눈금(월·연). 작품 순서는 관리자에 등록된 날짜 내림차순.
- **Surf** `/surf` — 3D 카드 덱.
- **인덱스** `/articles` — 12열 그리드, 월-연 라벨.
- **상세** `/p/<id>` — 클릭한 그림이 슬롯에서 상세로 날아가고(공유 플립), 닫으면 되돌아옵니다.
- **About** `/about`.

## 관리자
- **슬라이드**: 이미지, 라벨, 연월(Date), 규격/타입, 상세 본문 미디어, 추가·복제·삭제·정렬
- **이미지**: 업로드 / 삭제 (사용 중이면 확인)
- **텍스트**: 워드마크 3줄 + About 문구

## 구성
- `admin_server.py` — 사이트·관리자·JSON API (`/api/content`, `/api/aspects`, `/thumbs/<w>/<name>`)
- `site/` — 프론트엔드 (프레임워크·CDN 없음): `app.js` 라우터·인트로·전환, `carousel.js` 타임라인,
  `views.js` Surf·인덱스·About, `detail.js` 상세, `app.css`
- `content.json` — 편집 대상 전부 (슬라이드·워드마크·문구)
- `images/` — 그림 원본 (작가 본인 작업)
- `tools/` — 헤드리스 검증 스크립트 (`verify_flip.py`, `verify_exit.py`)

## 라이선스·크레딧
- 폰트: Spoqa Han Sans Neo, JetBrains Mono — SIL OFL 1.1 (`site/assets/fonts/LICENSE.md`)
- 아이콘: Noun Project, CC BY 3.0 — About 페이지에 저작자 표기가 렌더됩니다
- 그림: 작가 본인 저작물
- 필름 그레인(`site/assets/noise.png`): 자체 생성
