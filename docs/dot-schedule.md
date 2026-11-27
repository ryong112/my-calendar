# Dot 일정 등록 연결 (검토용)

현재 관리자 화면은 브라우저의 Firebase Google 로그인 상태를 사용합니다. 새 브라우저에는 이전 인증이 없으므로 기존 로그인이 이어지지 않습니다. 새 API는 브라우저 접근을 우회해 관리자 세션을 내주는 기능이 아닙니다. 운영자가 별도로 허용한 계정으로 지정된 캘린더의 새 일정만 생성합니다. 기존 Google 로그인, 권한과 화면은 수정하지 않습니다. 활성화 설정이 없으면 API는 503을 반환합니다.

## 한 번만 연결할 때 (운영 관리자)

1. Firebase 콘솔 **Authentication → Sign-in method / Users**에서 별도의 일정 기록 전용 계정을 준비합니다. Email/Password가 꺼져 있으면 프로젝트 전체 인증 정책과 일반 신규 가입 허용 여부부터 검토합니다. 기존 Google 관리자 계정이나 서비스 계정 키를 쓰지 않습니다. 가능하면 운영자만 전용 계정을 프로비저닝하고 신규 가입이 직접 데이터 권한을 주지 않음을 검증합니다.
2. Firestore 콘솔 **Rules**의 현재 규칙을 내보내 별도로 보관합니다. 정확한 전용 사용자 UID를 넣어 `dot-schedule.firestore.fragment`를 현재 `/events/{eventId}` 규칙에 합칩니다. **이 문서로 전체 규칙을 덮어쓰면 안 됩니다.** 기존 규칙에 이 UID를 포괄하는 쓰기 허용이 없음을 확인합니다. 에뮬레이터/규칙 시뮬레이터에서 관리자 원래 권한, 일정 공개 읽기 원래 정책, 전용 UID의 조건부 생성, 전용 UID의 수정/삭제 거부와 다른 데이터 접근 거부를 확인한 뒤 승인합니다.
3. 로컬에서 생성한 32바이트 난수(base64url) 인증 토큰과 전용 로그인 정보를 **Vercel 프로젝트 환경변수**에 넣습니다. `VITE_` 접두어, 저장소, 채팅, 캘린더 메모, URL 파라미터에는 자격증명을 넣지 않습니다. `DOT_CALENDAR_TOKEN`, `DOT_FIREBASE_API_KEY`, `DOT_FIREBASE_PROJECT_ID`, `DOT_FIREBASE_WRITER_UID`, `DOT_FIREBASE_WRITER_EMAIL`, `DOT_FIREBASE_WRITER_PASSWORD`를 정확히 사용합니다. 운영 토큰은 미확인 Vercel Preview에 노출하지 않습니다. 호출자에는 토큰만 보안 설정으로 관리합니다. 예: 승인된 Apps Script의 Script Properties. 앱을 직접 호출하는 별도 도구도 안전한 암호 보관 기능이 있을 때만 연결합니다.
4. 스테이징 프로젝트에서 401/405/503, 생성과 같은 요청 재시도, 동일 키의 변경된 내용 거부를 체크합니다. 운영 반영 후에는 허용된 작은 테스트 일정 1건을 만들고 웹 화면 표시와 중복 방지를 확인합니다. 일반 관리자만 테스트 일정을 삭제합니다. 차단하려면 토큰을 없애거나 교체하고, 즉시 전용 UID 허용 규칙을 제거합니다. 기존 웹 관리자의 접근은 유지합니다.

## 호출
`POST /api/dot-schedule`, `Content-Type: application/json`, `Authorization: Bearer <token>`

```json
{
  "requestKey": "google:example-stable-event-id",
  "title": "예시 일정 (오후)",
  "startDateKey": "2030-06-12",
  "group": "repair",
  "eventType": "visit",
  "status": "planned",
  "body": "오후 예정. 정확한 시각 미정."
}
```

`endDateKey`의 기본값은 시작일이며 **포함** 날짜입니다. Google 종일 종료일은 제외 날짜이므로 호출자가 변환합니다. 시각 미정일 경우 `startTime` 및 `endTime`을 생략합니다. 201은 생성, 200은 동일 요청의 재시도, 409는 같은 요청 키의 다른 내용이 이미 저장되었다는 뜻입니다. 409를 새 키로 무조건 재전송하지 마세요. 이미 수동 등록된 일정과의 중복 대조는 기존 달력 또는 승인된 소스에서 호출자가 먼저 합니다. 기존 일정 수정/삭제는 이 API의 권한 범위가 아닙니다.

`node --test test/dot-schedule.test.js`는 Firestore/인증 모의 서버로 검증합니다. 운영 데이터는 사용하지 않습니다.
