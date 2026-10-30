# BigInteger & FastBigIntStruct

직접 구현한 `FastBigIntStruct`와 .NET의 `System.Numerics.BigInteger`를 비교하는 벤치마크입니다. .NET 버전, 입력 자릿수, 연산 종류에 따른 실행 시간과 관리 힙 할당량을 측정하고 브라우저 리포트로 분석합니다.

## 빠른 시작

이 README가 있는 폴더에서 PowerShell로 실행합니다.

```powershell
# 모든 대상 프레임워크를 Release로 빌드
.\build.ps1

# 빌드된 프로그램을 버전별로 실행하고 결과 저장
.\run.ps1

# 측정 로그를 분석해 리포트 데이터와 CSV 갱신
node .\report.js

# 브라우저에서 리포트 열기
Start-Process .\docs\index.html
```

`run.ps1`은 빌드를 수행하지 않습니다. C# 코드를 수정했다면 먼저 `build.ps1`을 실행해야 합니다. 측정 결과와 리포트 데이터는 각각 다시 실행할 때 덮어씁니다.

## 실행 환경

- Windows PowerShell 또는 PowerShell
- 프로젝트의 `net11.0` 대상을 빌드할 수 있는 .NET SDK
- 각 대상에 해당하는 .NET 런타임: 6, 7, 8, 9, 10, 11
- 데이터 분석 스크립트를 실행할 Node.js
- JavaScript를 지원하는 브라우저

현재 대상 프레임워크는 `src/main.csproj`의 `TargetFrameworks`에 지정되어 있습니다. SDK와 런타임 설치 상태는 다음 명령으로 확인합니다.

```powershell
dotnet --list-sdks
dotnet --list-runtimes
node --version
```

`report.js`는 Node.js 내장 모듈만 사용하므로 `npm install`이 필요하지 않습니다. 리포트의 HTML·CSS·화면 스크립트·측정 데이터는 로컬 파일로 읽습니다. 외부 폰트나 CDN 리소스를 추가한 경우 해당 리소스에는 인터넷 연결이 필요할 수 있습니다.

## 폴더 구조

```text
.
├── src/
│   ├── main.cs                         # 정수 구현, 정확성 검증, 벤치마크
│   ├── main.csproj                     # .NET 6~11 다중 대상 프로젝트
│   ├── bin/                           # 빌드 결과
│   └── obj/                           # 빌드 중간 파일
├── results/
│   ├── environment.json               # 실행 시 수집한 하드웨어·OS·.NET 환경
│   ├── net6.0.txt                      # 런타임별 측정 로그
│   ├── ...
│   └── net11.0.txt
├── docs/
│   ├── index.html                     # 고정된 리포트 화면
│   ├── style.css                      # 화면 스타일
│   ├── app.js                         # 차트, 필터, 정렬
│   ├── measurements.js                # report.js가 생성하는 측정 데이터
│   ├── measurements.csv               # 전체 측정값
│   ├── implementation-comparison.csv  # 두 구현체의 비교값
│   └── version-comparison.csv         # 최초 버전 대비 변화
├── build.ps1
├── run.ps1
├── environment.ps1                    # 실행 환경 수집 함수
├── report.js
├── LICENSE.md
└── README.md
```

## 벤치마크 실행

### 테스트 환경

현재 장비에서 확인한 구성은 다음과 같습니다. 실제 측정에 연결된 환경은 `results/environment.json`과 리포트의 **테스트 환경** 섹션에서 확인합니다.

| 항목 | 구성 |
|---|---|
| CPU | 13th Gen Intel Core i9-13900K |
| 코어 / 논리 프로세서 | 24코어 / 32논리 프로세서 |
| 설치 메모리 | 128 GiB (32 GiB 모듈 4개) |
| RAM 속도 | WMI 설정 속도 보고값 4000, 실측값 아님 |
| OS | Windows 11 Pro, 64비트 |
| OS 버전 / 빌드 | 10.0.26300 / 26300 |
| .NET SDK | 11.0.100-rc.3.26522.148 |
| 빌드 / 실행 | Release / JIT, `PublishAot=false` |

`run.ps1`은 측정 시작 전에 CPU 모델·코어 수·보고 클럭, RAM 용량·모듈·설정 속도·시작 시 사용 가능 메모리, OS·장비 모델, 수집 가능한 경우 활성 전원 계획, .NET SDK·설치된 런타임, PowerShell 버전, 명시적으로 설정된 일부 .NET JIT/GC 환경 변수를 저장합니다. 장비를 바꾸면 다음 실행부터 해당 장비의 환경을 수집합니다.

환경 기록에는 실행 ID, 시작·종료 시각, 각 결과 파일의 SHA-256 해시도 포함됩니다. 리포트는 로그의 실행 ID와 파일 해시가 일치하는 경우에만 환경을 연결합니다. 이전 로그에 환경 기록이 없거나 파일이 교체된 경우에는 미확인으로 표시합니다. `report.js`를 실행하는 컴퓨터의 환경을 과거 측정의 환경으로 사용하지 않습니다.

이 정보는 측정 환경의 스냅샷입니다. CPU 클럭과 RAM 속도는 펌웨어/WMI 보고값이며, 부스트 클럭·실제 동작 속도·부하를 측정한 값이 아닙니다. 사용 가능 메모리는 측정 시작 시 시스템 전체의 값입니다. 수집할 수 없는 항목은 리포트에서 `미수집`으로 표시합니다.

### 전체 버전 측정

```powershell
.\build.ps1
.\run.ps1
```

`run.ps1`은 프로젝트에 지정된 각 프레임워크의 `src/bin/Release/<프레임워크>/main.dll`을 순서대로 실행합니다. 출력을 콘솔에 표시하고 `results/<프레임워크>.txt`에도 저장합니다.

기본 반복 횟수는 1,000,000회입니다. 다음과 같이 변경할 수 있습니다.

```powershell
.\run.ps1 -Iterations 200000
```

실제 표본당 반복 횟수는 입력 자릿수에 따라 줄어들며, 최소 1,000회입니다. 정확한 횟수는 각 로그의 `operations/sample`에 표시됩니다.

### 특정 버전만 실행

```powershell
dotnet run --project .\src\main.csproj -c Release -f net10.0 -- 200000
```

이 명령은 콘솔에 결과를 표시합니다. `results`에 버전별 파일로 저장하려면 `run.ps1`을 사용합니다.

### 정확성만 검증

```powershell
dotnet run --project .\src\main.csproj -c Release -f net10.0 -- --validate-only
```

검증은 `BigInteger`와 파싱·출력·덧셈·곱셈 결과를 비교합니다. 기본값 0, 경계값, 난수, 긴 자리올림, Karatsuba 분할 경계, 크기가 다른 피연산자도 포함합니다. 현재 구현은 1,173쌍과 기본값 0을 검증하며, 일반 벤치마크를 실행할 때도 측정 전에 검증합니다.

## 리포트 갱신

```powershell
node .\report.js
Start-Process .\docs\index.html
```

데이터 흐름은 다음과 같습니다.

```text
results/net*.txt
    → report.js
    → docs/measurements.js + CSV
    → index.html에서 app.js가 읽어 화면 표시
```

`report.js`는 HTML을 생성하거나 수정하지 않습니다. 화면을 바꾸려면 `docs/index.html`, `docs/style.css`, `docs/app.js`를 수정합니다. `measurements.js`와 CSV는 자동 생성 파일입니다.

다른 폴더의 측정 로그를 분석할 수도 있습니다. 출력 위치는 계속 `docs/`입니다.

```powershell
node .\report.js --results C:\benchmarks\results
node .\report.js --help
```

파일명은 `net10.0.txt` 같은 형식이어야 합니다. 각 파일에는 동일한 자릿수 조건과 덧셈·곱셈의 두 구현체 측정값이 있어야 합니다. 불완전하거나 중복된 측정값, 실패한 실행 로그는 분석에서 오류로 처리합니다.

### 제공하는 비교

- **자릿수별:** 같은 입력 크기에서 버전과 구현체 비교
- **버전별:** 한 런타임 안에서 자릿수별 비용 비교
- **구현체별:** BigInteger와 FastBigIntStruct 각각의 버전별 추이
- **승패 행렬:** 같은 조건의 상대 비용과 우세 구현체
- **기준 버전 대비:** 선택한 런타임을 기준으로 변화 확인
- **입력 증가 비용:** 자릿수가 커질 때 연산당 비용이 늘어나는 비율
- **조건별 순위:** 같은 자릿수·연산에서 비용이 낮은 상위 조합
- **전체 데이터:** 버전·자릿수·구현체 필터와 열 정렬, CSV 다운로드

시간과 할당량, 덧셈과 곱셈, 선형 축과 로그 축을 선택할 수 있습니다. 화면에서 선택하는 기준 버전과 달리, `version-comparison.csv`의 기준은 입력 파일 중 가장 낮은 .NET 버전으로 고정됩니다.

## 측정값 읽기

| 항목 | 의미 |
|---|---|
| `ns/op` | 연산 한 번의 시간. 낮을수록 빠릅니다. |
| `B/op` | 연산당 관리 힙 할당량. 낮을수록 적게 할당합니다. |
| Fast 속도 비율 | `BigInteger 시간 ÷ Fast 시간`. 1보다 크면 Fast가 빠릅니다. |
| 기준 버전 대비 속도 | `기준 버전 시간 ÷ 해당 버전 시간`. 1보다 크면 기준보다 빠릅니다. |
| 입력 증가 비용 | 같은 조건에서 `큰 입력 비용 ÷ 작은 입력 비용`입니다. |

현재 입력은 50·200·1,000자리의 고정된 두 피연산자입니다. 각 측정 항목은 최소 250ms 워밍업 후 7개 표본을 수집하며, 시간은 중앙값을 출력합니다. 파싱과 문자열 변환은 시간 측정에서 제외합니다.

`B/op`는 최대 메모리 사용량이나 스택 사용량이 아닙니다. 원시 표본과 분산은 로그에 저장되지 않으므로 작은 차이의 통계적 유의성은 판단할 수 없습니다. CPU 부하, 전원 설정, 런타임 버전 등에 따라 결과가 달라질 수 있습니다.

## FastBigIntStruct 구현

- 음이 아닌 임의 정밀도 정수이며, 기본값은 0입니다.
- `ulong` 배열에 `2^64` 단위로 저장합니다.
- 작은 수의 곱셈에는 `Math.BigMul`을 사용하는 기본 곱셈을 적용합니다.
- 큰 입력에는 Karatsuba 곱셈을 적용합니다. 짧은 쪽이 24개 블록 이상이고 분할 가능한 길이 조건일 때 전환합니다.
- Karatsuba 임시 공간은 작은 경우 스택, 큰 경우 `ArrayPool<ulong>`을 사용합니다.

비교 범위는 현재 구현의 덧셈·곱셈입니다. 음수, 나눗셈 등 `BigInteger`의 전체 기능을 대체하는 구현은 아닙니다.

## 문제 해결

- **빌드 출력이 없다는 오류:** `build.ps1`을 먼저 실행합니다.
- **런타임을 찾지 못하는 오류:** 해당 .NET 런타임 설치 여부를 확인합니다.
- **`NETSDK1207` AOT 오류:** 현재 벤치마크는 일반 JIT 실행용이며 프로젝트의 `PublishAot`는 `false`입니다.
- **측정 결과가 느린 경우:** `Release` 설정인지 확인합니다. 별도 명령으로 Debug 빌드를 측정한 결과와 비교하지 않습니다.
- **리포트가 이전 결과를 표시하는 경우:** `node .\report.js`를 다시 실행하고 브라우저를 새로고침합니다.
- **측정 데이터를 불러오지 못하는 경우:** `index.html`, `style.css`, `app.js`, `measurements.js`가 모두 `docs/`에 있는지 확인합니다.

## 라이선스

[LICENSE.md](LICENSE.md)를 확인하세요.
