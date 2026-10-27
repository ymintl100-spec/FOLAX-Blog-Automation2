# 네이버 블로그 자동화

Google Chrome 확장프로그램과 Codex CLI로 네이버·티스토리 글 생성 및 발행을 관리하는 Electron 앱입니다. 로그인은 사용자가 Chrome에서 직접 진행합니다.

## 실행

Node.js 24 이상, Google Chrome, 로그인된 Codex CLI가 필요합니다.

```sh
npm ci
npm start
```

개발 데이터는 기존 `runtime` 폴더에 저장됩니다. 업데이트 시 이 폴더를 유지하세요. 배포판은 OS의 앱 사용자 데이터 폴더를 사용합니다.

## 최초 연결

1. 앱에서 블로그 ID를 등록하고 **블로그 열기 / 로그인**을 실행합니다.
2. **크롬 확장 설치 → 설치 폴더 준비**로 확장 경로를 확인합니다.
3. 해당 Chrome의 `chrome://extensions`에서 개발자 모드를 켜고 **압축해제된 확장 프로그램을 로드합니다**로 폴더를 선택합니다.
4. 앱의 **확장프로그램 연결** 코드를 확장에 입력합니다.

계정별 Chrome마다 최초 연결이 필요합니다. 티스토리를 사용하면 공용 Chrome에도 로그인·연결하세요. 확장 업데이트 후에는 설치 폴더를 준비하고 확장 관리 화면에서 새로고침합니다.

## 배포

```sh
npm run dist           # Windows 휴대용 EXE: Windows에서 실행
npm run dist:mac:arm64 # Apple Silicon DMG: macOS에서 실행
npm run dist:mac:x64   # Intel DMG: macOS에서 실행
```

결과물은 `dist`에 생성되며 테스트·개인 데이터는 제외합니다. macOS에서는 `npm ci`를 새로 실행하세요. macOS 대응은 코드·모의 환경을 검증했으며 실제 Mac 실행·설치는 미검증입니다. 코드 서명·공증은 별도 설정이 필요합니다.

기존 [blogauto-naver](https://github.com/boksajang/blogauto-naver)를 기반으로 합니다. 윤문 규칙의 출처와 라이선스는 [NOTICE](packages/blog-humanizer/NOTICE), [LICENSE](packages/blog-humanizer/LICENSE)에 보존합니다.

## 라이선스

이 프로젝트의 자체 코드는 [MIT 라이선스](LICENSE)를 따릅니다. Copyright (c) 2026 boksajang.

제3자 구성요소에는 각 구성요소의 기존 라이선스와 저작권·출처 고지가 적용되며, 해당 고지를 유지해야 합니다. 특히 윤문 규칙의 [기존 LICENSE](packages/blog-humanizer/LICENSE)와 [NOTICE](packages/blog-humanizer/NOTICE)는 그대로 유지합니다.


## FOLAX 원본 근거(선택 연결)

포렉스 제품 데이터는 **공개 GitHub 저장소에 넣지 않고** 앱의 로컬 런타임 폴더에서만 조회합니다.
20차 검증된 색인(2026-10-27 스냅샷)을 `<런타임 루트>/folax/evidence.jsonl`에 직접 배치하세요.
앱의 런타임 루트는 기본적으로 Electron `userData/runtime`이며, `BLOGAUTO_RUNTIME_ROOT`를 설정한 경우 해당 폴더가 사용됩니다. `runtime/`은 Git에 포함되지 않습니다.

수집본 4,945건은 판매페이지·옵션·제품·이미지·시험근거를 찾는 **과거 자료 색인**입니다.
원고 작성 단계의 근거 후보는 참고용이며, 현행 가격·효능·최신 제품 사양·시험 시료 동일성·상업적 이미지 권리를 승인하지 않습니다.
포렉스 브랜드나 특정 제품이 감지된 원고는 `publishSequence` 진입 시 네이버·티스토리 **자동 발행/외부 임시저장 이전에 차단**됩니다. 별도의 제품·표현·권리 승인 워크플로가 연결되기 전까지 이 차단을 임의로 해제하지 마세요.
일반 발 건강 정보 원고는 기존 발행 흐름을 유지하며, 이는 해당 콘텐츠에 대한 법적 또는 사실적 인증을 뜻하지 않습니다.

검증: `node --test src/lib/folaxIntegration.test.js`. 브랜치 적용 전에는 운영 앱에 영향이 없으며, 실제 Electron·브라우저·발행 통합시험은 별도로 필요합니다.
