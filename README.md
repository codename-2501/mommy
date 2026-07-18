# LSE GALLERY — 회화 아카이브

승은(Seung Eun)의 유화 작업을 월별 타임라인으로 보여주는 정적 사이트입니다.
외부 CMS·프레임워크·CDN 없이 `content.json` 하나와 바닐라 JS 로 굴러갑니다.

## 뷰
- **타임라인** `/` — 가로 캐러셀 + 상단 눈금(월·연). 작품은 날짜 내림차순.
- **Flow** `/flow` — 3D 카드 덱.
- **인덱스** `/articles` — 그리드, 월-연 라벨, 날짜/색상/크기 정렬.
- **상세** `/p/<id>` — 클릭한 그림이 상세로 날아가고(공유 플립), 닫으면 되돌아옵니다.
- **About** `/about`.

## 빌드 / 배포
정적 호스트(GitHub Pages)용으로 `content.json` 과 이미지에서 사이트를 굽습니다.
```
pip install pillow                 # 썸네일/종횡비 (유일한 의존성)
python3 build_static.py            # -> dist/  (프로젝트 페이지면 --base=/<repo>)
```
`.github/workflows/pages.yml` 이 main 푸시마다 위 빌드를 돌려 Pages 로 배포합니다.

## 구성
- `site/` — 프론트엔드: `app.js` 라우터·인트로·전환, `carousel.js` 타임라인,
  `views.js` Flow·인덱스·About, `detail.js` 상세, `app.css`
- `content.json` — 슬라이드·워드마크·문구 등 콘텐츠 전부
- `build_static.py` · `build_shared.py` — 정적 빌드(head 주입·색 추출·썸네일)
- `images/` — 그림 원본 (작가 본인 작업)
- `icons/` — 메뉴 아이콘

## 라이선스·크레딧
- 폰트: Spoqa Han Sans Neo, JetBrains Mono — SIL OFL 1.1. 저작권 표기와 라이선스 전문을
  `site/assets/fonts/` 에 동봉했다(OFL 요구사항). 배포 시 woff2 와 함께 반드시 포함할 것.
  Spoqa Han Sans Neo 는 예약 폰트명이 걸려 있어, 파일을 수정·서브셋하면 다른 이름으로 배포해야 한다.
- 아이콘: Noun Project, CC BY 3.0 — About 페이지에 저작자 표기가 렌더됩니다
- 그림: 작가 본인 저작물
- 필름 그레인(`site/assets/noise.png`): 자체 생성
