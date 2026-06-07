# ProTone Studio Firebase V2

PC웹과 모바일웹에서 쓰기 좋은 다크/그레이 톤의 AI 사진 보정 툴입니다.

## 구성

- `public/`: 정적 웹앱 UI와 브라우저 기반 이미지 보정 로직
- `functions/`: Firebase Functions 프록시 API
- `/api/smart-adjust`: OpenAI Responses API로 사진을 판단하고 보정값 JSON을 반환

OpenAI API 또는 Firebase Functions가 준비되지 않은 상태에서도 웹앱은 브라우저 로컬 분석 보정으로 동작합니다.

## 로컬 미리보기

```powershell
cd C:\ClaudeProject\ProToneStudioFirebaseV2
npm.cmd run preview
```

브라우저에서 `http://localhost:5174`를 열면 됩니다. 이 모드는 정적 화면 확인용이라 AI API는 로컬 분석으로 대체됩니다.

## GitHub + Firebase 자동 배포

이 프로젝트는 로컬 PC를 서버로 쓰지 않습니다. GitHub 저장소에 push하면 GitHub Actions가 Firebase Hosting과 Firebase Functions로 배포하도록 `.github/workflows/firebase-deploy.yml`을 포함합니다.

### 1. GitHub 저장소에 올리기

```powershell
cd C:\ClaudeProject\ProToneStudioFirebaseV2
git add .
git commit -m "Initial ProTone Studio Firebase web app"
git branch -M main
git remote add origin <GITHUB_REPOSITORY_URL>
git push -u origin main
```

### 2. Firebase 프로젝트 만들기

Firebase Console에서 프로젝트를 만들고 프로젝트 ID를 확인합니다.

`.firebaserc`의 `REPLACE_WITH_FIREBASE_PROJECT_ID`를 실제 프로젝트 ID로 바꿔도 되고, GitHub Actions에서는 `FIREBASE_PROJECT_ID` secret을 사용합니다.

### 3. GitHub Secrets 등록

GitHub 저장소의 `Settings > Secrets and variables > Actions`에 아래 값을 넣습니다.

| Secret 이름 | 내용 |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `GCP_SA_KEY` | Firebase 배포 권한이 있는 Google Cloud service account JSON 전체 |

Firebase 프로젝트 ID는 `protone-studio`로 설정되어 있습니다.

`GCP_SA_KEY`는 GitHub Actions가 Firebase에 배포할 때 쓰는 서버용 인증키입니다. 로컬 PC 인증을 쓰지 않습니다.

현재 배포 계정 예시:

```text
firebase-adminsdk-fbsvc@protone-studio.iam.gserviceaccount.com
```

이 계정에는 최소한 Firebase Hosting/Functions 배포와 Secret Manager 접근 권한이 필요합니다. 빠른 첫 배포 확인용으로는 Google Cloud Console의 `IAM 및 관리자 > IAM`에서 이 principal에 아래 역할을 부여하면 됩니다.

- Firebase Admin
- Cloud Functions Admin
- Secret Manager Admin
- Service Usage Admin
- Service Account User
- Cloud Run Admin
- Cloud Build Editor
- Artifact Registry Administrator

배포 성공 후 운영 단계에서는 권한을 더 좁히는 것을 권장합니다.

처음에는 배포용 service account에 Firebase/Cloud Functions/Hosting 배포 권한을 충분히 부여하고, 운영 단계에서 권한을 좁히는 것을 권장합니다.

### 4. 자동 배포

`main` 브랜치에 push하면 GitHub Actions가 자동으로 실행됩니다.

```text
GitHub repo push -> GitHub Actions -> Firebase Hosting + Functions -> https://프로젝트ID.web.app
```

## 수동 Firebase 배포

자동 배포 대신 직접 배포하고 싶을 때만 아래 방식을 사용합니다.

```powershell
cd C:\ClaudeProject\ProToneStudioFirebaseV2
cd functions
npm.cmd install
cd ..
firebase login
firebase use --add
firebase functions:secrets:set OPENAI_API_KEY
firebase deploy
```

`.firebaserc`의 `REPLACE_WITH_FIREBASE_PROJECT_ID`를 실제 Firebase 프로젝트 ID로 바꿔도 됩니다.

기본 OpenAI 모델은 `gpt-5-mini`입니다. 다른 모델을 쓰려면 Firebase Functions 환경변수 `OPENAI_MODEL`을 설정하면 됩니다.

## Git 시작

```powershell
cd C:\ClaudeProject\ProToneStudioFirebaseV2
git init
git add .
git commit -m "Initial ProTone Studio Firebase web app"
```

원격 저장소를 만든 뒤 `git remote add origin <repo-url>`과 `git push -u origin main`을 실행하면 됩니다.

## 참고 문서

- Firebase Hosting rewrite to Functions: https://firebase.google.com/docs/hosting/functions
- Firebase Functions secrets: https://firebase.google.com/docs/functions/config-env
- OpenAI Responses API: https://platform.openai.com/docs/api-reference/responses
