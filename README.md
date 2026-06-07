# ProTone Studio Web

PC웹과 모바일웹에서 쓰기 좋은 다크/그레이 톤의 AI 사진 보정 툴입니다.

Firebase Blaze 요금제를 쓰지 않기 위해 워드울프 프로젝트처럼 아래 구조로 바꿨습니다.

```text
GitHub Pages
-> 정적 웹앱 호스팅

Supabase Edge Function
-> OpenAI API 키를 Secret으로 숨기고 AI 스마트 보정과 얼굴 감지 실행
```

OpenAI API 또는 Supabase 설정이 없으면 앱은 브라우저 로컬 분석 보정으로 자동 대체됩니다.

## 구성

- `public/`: GitHub Pages에 올라가는 정적 웹앱
- `public/protone-config.js`: Supabase URL과 anon key 설정
- `supabase/functions/smart-adjust/`: OpenAI를 호출하는 스마트 보정 Edge Function
- `supabase/functions/detect-faces/`: OpenAI Vision으로 얼굴 박스를 찾는 Edge Function
- `.github/workflows/deploy-pages.yml`: GitHub Pages 배포
- `.github/workflows/deploy-supabase-functions.yml`: Supabase Edge Function 배포

## GitHub Secrets

GitHub 저장소의 `Settings > Secrets and variables > Actions`에 아래 값을 넣습니다.

| Secret 이름 | 용도 |
| --- | --- |
| `SUPABASE_URL` | 예: `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase Project Settings > API의 anon/publishable key |
| `SUPABASE_PROJECT_REF` | Supabase 프로젝트 ref. URL의 `xxxx` 부분 |
| `SUPABASE_ACCESS_TOKEN` | Supabase 계정 Access Token |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `OPENAI_MODEL` | 선택 사항. 기본값 `gpt-4.1-mini` |
| `OPENAI_VISION_MODEL` | 선택 사항. 얼굴 감지 전용 모델. 없으면 `OPENAI_MODEL` 사용 |
| `ALLOWED_ORIGINS` | 선택 사항. 기본값 `https://noctis248650-cyber.github.io,http://localhost:5174,http://127.0.0.1:5174` |

`SUPABASE_ANON_KEY`는 브라우저에 공개되는 키입니다. 정상입니다. `OPENAI_API_KEY`는 Supabase Secret에만 저장되고 브라우저로 내려가지 않습니다.

## Supabase 설정

1. Supabase 프로젝트를 만듭니다.
2. Project Settings > API에서 `Project URL`, `anon public` 또는 `publishable` key를 확인합니다.
3. Account > Access Tokens에서 토큰을 만듭니다.
4. 위 값을 GitHub Secrets에 등록합니다.
5. GitHub Actions에서 `Deploy Supabase Functions`를 수동 실행하거나 `main`에 push합니다.

## GitHub Pages 설정

GitHub 저장소 `Settings > Pages`에서 Source를 `GitHub Actions`로 설정합니다.

그 뒤 `main` 브랜치에 push하면 `.github/workflows/deploy-pages.yml`이 `public/` 폴더를 배포합니다.

배포 주소:

```text
https://noctis248650-cyber.github.io/ProToneStudio/
```

## 로컬 미리보기

```powershell
cd C:\ClaudeProject\ProToneStudioFirebaseV2
npm.cmd run preview
```

브라우저에서 열기:

```text
http://localhost:5174
```

로컬에서 Supabase AI까지 테스트하려면 `public/protone-config.js`에 Supabase URL과 anon key를 넣습니다. 이 값은 공개 키라 괜찮지만, OpenAI API 키는 절대 여기에 넣지 않습니다.

## 배포 흐름

```text
내 PC에서 코드 작업
-> GitHub main push
-> GitHub Pages가 정적 웹앱 배포
-> Supabase Edge Function이 AI 스마트 보정과 얼굴 감지 담당
```

## 보안 메모

이 구조는 OpenAI API 키를 브라우저에 노출하지 않습니다. 다만 공개 웹앱의 AI 함수는 호출 남용 가능성이 있으므로 `ALLOWED_ORIGINS`를 GitHub Pages 도메인으로 제한해두었습니다. 더 강한 보호가 필요하면 Supabase Auth, CAPTCHA, 사용자별 사용량 제한을 추가하는 것이 좋습니다.
