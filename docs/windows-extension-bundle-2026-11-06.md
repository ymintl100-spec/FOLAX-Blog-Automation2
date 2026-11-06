# Windows 실행파일·Chrome 확장 통합 패키지

FOLAX Windows 통합 다운로드 — 앱 0.3.0-rc.24 + Chrome 확장 0.3.23

한 번 다운로드하면 Windows 실행파일과 압축 해제된 Chrome 확장 폴더가 함께 준비됩니다. 확장 ZIP을 따로 내려받거나 다시 압축 해제할 필요가 없습니다.

다운로드 후 폴더 구성
Naver-Blog-Automator-0.3.0-rc.24.exe
Chrome-Extension/
  manifest.json
  background.js
  editor.js
  그 밖의 확장 파일과 icons 폴더
README.txt
FOLAX-All-In-One-Guide.html

실행·확장 설치 방법
1. FOLAX-All-In-One-Download.exe를 실행하고 다운로드·검증·압축 해제가 끝날 때까지 기다립니다. 완료되면 BlogAuto-Windows 폴더가 열립니다.
2. 필요하면 이 폴더 전체를 원하는 설치 위치로 먼저 옮긴 다음 Naver-Blog-Automator-0.3.0-rc.24.exe를 실행하세요. 기존 프로그램은 종료한 뒤 실행합니다.
3. 사용할 블로그 계정의 Chrome 창에서 chrome://extensions를 엽니다. 개발자 모드를 켜고 ‘압축해제된 확장 프로그램을 로드합니다’를 눌러 같은 폴더 안의 Chrome-Extension 폴더를 선택합니다. manifest.json이 들어 있는 폴더를 선택해야 합니다.
4. BlogAuto 버전이 0.3.23인지 확인하고 앱의 ‘브라우저 연결’에서 받은 계정 연결 코드를 확장에 입력합니다. 이전 경로의 BlogAuto가 이미 설치돼 있다면 새 확장과 동시에 켜 두지 마세요. 기존 폴더를 그대로 사용할 경우 Chrome-Extension 안의 파일을 기존 로드 폴더에 덮어쓴 후 새로고침하는 방법도 가능합니다.
5. 원고 탭에서 기존 원고를 열어 진행하세요. 본문과 이미지를 다시 생성할 필요가 없습니다.

설치 후 Chrome-Extension 폴더를 이동하거나 삭제하지 마세요. Chrome은 해당 폴더의 파일을 계속 사용합니다. 다른 PC로 옮길 때도 실행파일과 Chrome-Extension 폴더를 함께 옮기고 그 PC의 Chrome에서 확장을 로드·연결하세요. 기존 PC의 계정·원고 데이터까지 자동으로 옮기는 패키지는 아닙니다.

기존 데이터와 수정 사항
이번 배포는 실행파일 옆에 압축 해제된 확장을 추가한 통합 패키지입니다. 앱과 확장 코드는 이전에 제공한 rc.24 / 0.3.23과 같습니다. 기존 Windows 사용자 계정의 앱 데이터 경로와 계정·설정·원고·작업 기록을 변경하지 않습니다. 네이버 본문 정렬 오류 수정과 실패 원고 직접 승인 기능을 포함합니다.

검증
기존 앱의 자동 테스트 262개 통과 결과를 유지합니다. 이번 변경은 패키징만 변경했으며, ZIP 내부와 다운로드·압축 해제 후 실행파일 및 Chrome-Extension 전체 파일이 원본과 같은지 검증합니다. 실제 네이버 글을 발행하지 않았습니다.

재현: python3 scripts/package-windows.py --output <출력 폴더> --guide <안내 HTML> --readme <안내 TXT>. 현재 빌드와 원본 앱·확장 파일의 일치를 검사한 뒤 ZIP 루트에 EXE, Chrome-Extension 폴더, README와 안내 HTML을 함께 넣습니다. 기존 실행파일을 다시 빌드하거나 기존 공개 릴리스 파일을 교체하지 않습니다.
