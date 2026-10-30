'use strict';
(() => {
    const reportHeader = document.getElementById('report-header');
    const syncHeaderHeight = () => {
        const height = Math.ceil(reportHeader.getBoundingClientRect().height);
        document.documentElement.style.setProperty('--report-header-height', `${height}px`);
    };

    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(syncHeaderHeight).observe(reportHeader);
    }
    window.addEventListener('resize', syncHeaderHeight);
    syncHeaderHeight();

    const DATA = window.BENCHMARK_DATA;
    if (
        !DATA ||
        !Array.isArray(DATA.rows) ||
        !DATA.rows.length ||
        !Array.isArray(DATA.runtimes) ||
        !DATA.runtimes.length
    )
        return;
    const ROWS = DATA.rows;
    const VERSIONS = DATA.runtimes.map((x) => x.framework);
    const DIGITS = DATA.runtimes[0].digits;
    const IMPLS = ['Fast', '.NET'];
    const NAMES = { Fast: 'FastBigIntStruct', '.NET': 'BigInteger' };
    const COLORS = ['#2563eb', '#bd650b', '#168270', '#904eb2', '#b13d62', '#54617a'];
    const $ = (id) => document.getElementById(id);
    const esc = (x) =>
        String(x).replace(
            /[&<>"']/g,
            (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
        );
    const fmt = (x, decimals = 2) =>
        Number(x).toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        });
    const ratio = (a, b) => (b === 0 ? null : a / b);
    const rf = (x) => (x === null ? '—' : fmt(x) + '×');
    const signed = (x) => (x > 0 ? '+' : '') + fmt(x);
    const opName = (op) => (op === '+' ? '덧셈 (+)' : '곱셈 (*)');
    const INDEX = new Map(
        ROWS.map((r) => [[r.framework, r.digits, r.implementation, r.operation].join('|'), r])
    );
    const get = (v, d, i, o) => INDEX.get([v, d, i, o].join('|'));
    const frameworkOrder = (v) => VERSIONS.indexOf(v);
    let sortKey = 'framework',
        sortDirection = 1;
    function state() {
        return {
            metric: $('metric').value,
            ops: $('operation').value === 'all' ? ['+', '*'] : [$('operation').value],
            log: $('scale').value === 'log',
            base: $('baseline-select').value,
        };
    }
    function unit(s) {
        return s.metric === 'ns_op' ? 'ns/op' : 'B/op';
    }
    function measureName(s) {
        return s.metric === 'ns_op' ? '연산 시간' : '할당량';
    }
    function transform(x, s) {
        return s.log ? Math.log1p(x) : x;
    }
    function scaleLabel(s) {
        return `${unit(s)} · ${s.log ? '로그 축 log(1 + 값)' : '선형 축'} · 낮을수록 좋음`;
    }
    function table(headers, rows, klass = '') {
        return /* HTML */ `<div class="tablewrap">
            <table class="${klass}">
                <thead>
                    <tr>
                        ${headers.map((x) => /* HTML */ `<th>${x}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${rows.join('')}
                </tbody>
            </table>
        </div>`;
    }
    function cell(x, cls = '') {
        return /* HTML */ `<td${cls ? ` class="${cls}"` : ''}>${x}</td>`;
    }
    function resultClass(f, n) {
        return f < n ? 'good' : f > n ? 'slow' : '';
    }
    function bar(row, max, s) {
        const value = row[s.metric],
            width = max === 0 ? 0 : (transform(value, s) / transform(max, s)) * 100;
        return /* HTML */ `<div class="barline">
            <span>${row.implementation === 'Fast' ? 'Fast' : '.NET'}</span>
            <div class="track">
                <div
                    class="bar ${row.implementation === 'Fast' ? 'fast' : 'net'}"
                    style="width:${width}%"
                ></div>
            </div>
            <span class="value">${fmt(value)}</span>
        </div>`;
    }
    function pairGroup(label, fast, net, max, s) {
        const f = fast[s.metric],
            n = net[s.metric];
        return /* HTML */ `<div class="group">
            <div class="grouptitle">
                <span>${esc(label)}</span
                ><small
                    >${f < n ? 'Fast 우세' : f > n ? 'BigInteger 우세' : '동일'} ·
                    ${rf(ratio(n, f))}</small
                >
            </div>
            ${bar(fast, max, s)}${bar(net, max, s)}
        </div>`;
    }
    function panel(title, description, body) {
        return /* HTML */ `<article class="panel">
            <h3>${esc(title)}</h3>
            <p class="muted">${esc(description)}</p>
            ${body}
        </article>`;
    }
    function fillOptions(id, values, all) {
        $(id).innerHTML =
            (all ? '<option value="all">전체</option>' : '') +
            values.map((x) => /* HTML */ `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    }

    function renderOverview(s) {
        const pairs = DATA.comparisons.filter((c) => s.ops.includes(c.operation));
        const wins = { Fast: 0, net: 0, ties: 0 };
        const deltas = pairs.map((c) => {
            const f = get(c.framework, c.digits, 'Fast', c.operation)[s.metric],
                n = get(c.framework, c.digits, '.NET', c.operation)[s.metric];
            if (f < n) wins.Fast++;
            else if (f > n) wins.net++;
            else wins.ties++;
            return { ...c, f, n, r: ratio(n, f) };
        });
        const comparable = deltas.filter((x) => x.r !== null);
        const best = comparable.length ? comparable.reduce((a, b) => (a.r > b.r ? a : b)) : null;
        $('stats').innerHTML = [
            [
                '비교 범위',
                `${VERSIONS.length}개 버전`,
                `${DIGITS.length}개 자릿수 · ${s.ops.length}개 연산`,
            ],
            ['Fast 우세', `${wins.Fast} / ${pairs.length}`, measureName(s) + ' 기준'],
            ['BigInteger 우세', `${wins.net} / ${pairs.length}`, `동일한 조건 ${wins.ties}개`],
            ['Fast 최대 비율', best ? rf(best.r) : '—', 'BigInteger 값 ÷ Fast 값'],
        ]
            .map(
                (x) =>
                    /* HTML */ `<div class="stat">
                        <span>${esc(x[0])}</span><strong>${esc(x[1])}</strong
                        ><small>${esc(x[2])}</small>
                    </div>`
            )
            .join('');
        let items = [];
        for (const op of s.ops) {
            const subset = deltas.filter((x) => x.operation === op);
            const fastWins = subset.filter((x) => x.f < x.n).length;
            const netWins = subset.filter((x) => x.f > x.n).length;
            const outcome = s.metric === 'ns_op' ? '빠릅니다' : '적게 할당합니다';
            items.push(
                `${opName(op)}: ${subset.length}개 조건 중 Fast가 ${fastWins}개, ` +
                    `BigInteger가 ${netWins}개에서 ${outcome}.`
            );
        }
        if (best)
            items.push(
                `Fast 비율이 가장 큰 조건: ${best.framework} · ${fmt(best.digits, 0)}자리 · ` +
                    `${opName(best.operation)} — Fast ${fmt(best.f)} ${unit(s)}, ` +
                    `BigInteger ${fmt(best.n)} ${unit(s)} (${rf(best.r)}).`
            );
        const losses = deltas.filter((x) => x.f > x.n).sort((a, b) => b.f - b.n - (a.f - a.n));
        if (losses.length) {
            const x = losses[0];
            items.push(
                `Fast의 절대 비용 차이가 가장 큰 열세 조건: ${x.framework} · ` +
                    `${fmt(x.digits, 0)}자리 · ${opName(x.operation)} — ` +
                    `BigInteger보다 ${fmt(x.f - x.n)} ${unit(s)} 큽니다.`
            );
        } else items.push('선택한 지표와 연산에서는 Fast가 더 큰 비용을 보인 조건이 없습니다.');
        $('takeaways').innerHTML = items.map((x) => /* HTML */ `<li>${esc(x)}</li>`).join('');
    }
    function renderDigits(s) {
        let cards = [];
        for (const op of s.ops)
            for (const d of DIGITS) {
                const rows = ROWS.filter((r) => r.digits === d && r.operation === op);
                const max = Math.max(...rows.map((r) => r[s.metric]));
                cards.push(
                    panel(
                        `${fmt(d, 0)}자리 · ${opName(op)}`,
                        scaleLabel(s),
                        VERSIONS.map((v) =>
                            pairGroup(v, get(v, d, 'Fast', op), get(v, d, '.NET', op), max, s)
                        ).join('')
                    )
                );
            }
        $('digits-charts').innerHTML = cards.join('');
    }
    function renderVersions(s) {
        let cards = [];
        for (const v of VERSIONS)
            for (const op of s.ops) {
                const rows = ROWS.filter((r) => r.framework === v && r.operation === op);
                const max = Math.max(...rows.map((r) => r[s.metric]));
                cards.push(
                    panel(
                        `${v} · ${opName(op)}`,
                        scaleLabel(s),
                        DIGITS.map((d) =>
                            pairGroup(
                                `${fmt(d, 0)}자리`,
                                get(v, d, 'Fast', op),
                                get(v, d, '.NET', op),
                                max,
                                s
                            )
                        ).join('')
                    )
                );
            }
        $('version-charts').innerHTML = cards.join('');
    }

    function trendChart(impl, op, s) {
        const width = 700,
            height = 270,
            left = 72,
            right = 24,
            top = 18,
            bottom = 42,
            plotWidth = width - left - right,
            plotHeight = height - top - bottom;
        const rows = ROWS.filter((r) => r.implementation === impl && r.operation === op),
            max = Math.max(...rows.map((r) => r[s.metric]));
        const domain = transform(max, s) || 1;
        const x = (i) =>
            left +
            (VERSIONS.length === 1 ? plotWidth / 2 : (i * plotWidth) / (VERSIONS.length - 1));
        const y = (v) => top + plotHeight * (1 - transform(v, s) / domain);
        const elements = [];
        for (let i = 0; i <= 4; i++) {
            const transformed = (domain * i) / 4,
                raw = s.log ? Math.expm1(transformed) : transformed,
                yp = top + plotHeight * (1 - i / 4);
            elements.push(/* SVG */ `<line
                    class="tick"
                    x1="${left}"
                    x2="${width - right}"
                    y1="${yp}"
                    y2="${yp}"
                /><text x="${left - 10}" y="${yp + 4}" text-anchor="end"
                    >${fmt(raw, raw < 10 ? 1 : 0)}</text
                >`);
        }
        elements.push(/* SVG */ `<text x="${left}" y="12">${unit(s)}</text>`);
        VERSIONS.forEach((v, i) => {
            elements.push(/* SVG */ `<text x="${x(i)}" y="${height - 16}" text-anchor="middle"
                >${esc(v)}</text
            >`);
        });
        DIGITS.forEach((d, k) => {
            const color = COLORS[k % COLORS.length],
                values = VERSIONS.map((v) => get(v, d, impl, op)[s.metric]);
            elements.push(/* SVG */ `<polyline
                fill="none"
                stroke="${color}"
                stroke-width="2.5"
                points="${values.map((v, i) => x(i) + ',' + y(v)).join(' ')}"
            />`);
            values.forEach((v, i) => {
                elements.push(/* SVG */ `<circle
                    cx="${x(i)}"
                    cy="${y(v)}"
                    r="4"
                    fill="${color}"
                    stroke="white"
                    stroke-width="1.5"
                    ><title>
                        ${esc(VERSIONS[i] + ' · ' + fmt(d, 0) + '자리: ' + fmt(v) + ' ' + unit(s))}
                    </title></circle
                >`);
            });
        });
        // Keep one complete SVG wrapper so HTML formatting cannot close it early.
        const svg = /* HTML */ `<svg
            class="linechart"
            role="img"
            aria-label="${esc(NAMES[impl] + ' ' + opName(op) + ' 버전별 ' + measureName(s))}"
            viewBox="0 0 ${width} ${height}"
        >
            <title>${esc(NAMES[impl] + ' 버전별 ' + measureName(s))}</title>
            ${elements.join('')}
        </svg>`;
        const legend = /* HTML */ `<div class="legend">
            ${DIGITS.map((d, k) => {
                const color = COLORS[k % COLORS.length];
                return /* HTML */ `<span>
                    <i class="swatch" style="background:${color}"></i>${fmt(d, 0)}자리
                </span>`;
            }).join('')}
        </div>`;
        const exact = table(
            ['자릿수', ...VERSIONS.map(esc)],
            DIGITS.map(
                (d) =>
                    '<tr>' +
                    cell(fmt(d, 0)) +
                    VERSIONS.map((v) => cell(fmt(get(v, d, impl, op)[s.metric]))).join('') +
                    '</tr>'
            )
        );
        return (
            legend +
            /* HTML */ `<div class="chartscroll">${svg}</div>
                <details>
                    <summary>정확한 측정값 표 (${unit(s)})</summary>
                    ${exact}
                </details>`
        );
    }
    function renderImplementations(s) {
        $('implementation-charts').innerHTML = s.ops
            .flatMap((op) =>
                IMPLS.map((impl) =>
                    panel(`${NAMES[impl]} · ${opName(op)}`, scaleLabel(s), trendChart(impl, op, s))
                )
            )
            .join('');
    }
    function renderHeatmap(s) {
        $('heat-caption').textContent =
            `${s.metric === 'ns_op' ? '속도' : '비용'} 비율 = BigInteger ${unit(s)} ÷ Fast ${unit(s)}. ` +
            '1보다 크면 Fast 우세(초록), 작으면 BigInteger 우세(주황), 같으면 동일합니다. ' +
            '정확한 값은 셀에 마우스를 올려 확인하세요.';
        $('heat-tables').innerHTML = s.ops
            .map((op) => {
                const body = DIGITS.map(
                    (d) =>
                        '<tr>' +
                        cell(fmt(d, 0) + '자리') +
                        VERSIONS.map((v) => {
                            const f = get(v, d, 'Fast', op)[s.metric],
                                n = get(v, d, '.NET', op)[s.metric],
                                r = ratio(n, f);
                            const color =
                                f < n
                                    ? 'rgba(17,139,95,.13)'
                                    : f > n
                                      ? 'rgba(208,109,32,.15)'
                                      : '#f3f6fa';
                            return /* HTML */ `<td
                                style="background:${color}"
                                title="Fast ${fmt(f)} ${unit(s)} / BigInteger ${fmt(n)} ${unit(s)}"
                            >
                                ${rf(r)}<small
                                    >${f < n ? 'Fast' : f > n ? 'BigInteger' : '동일'}</small
                                >
                            </td>`;
                        }).join('') +
                        '</tr>'
                );
                return panel(
                    opName(op),
                    '두 구현체의 상대 비용',
                    table(['자릿수', ...VERSIONS.map(esc)], body, 'heat')
                );
            })
            .join('');
    }
    function renderBaseline(s) {
        $('baseline-caption').textContent =
            `기준: ${s.base}. ` +
            (s.metric === 'ns_op'
                ? '기준 버전 시간 ÷ 해당 버전 시간입니다. 1보다 크면 기준보다 빠릅니다.'
                : '해당 버전 B/op − 기준 버전 B/op입니다. 음수면 기준보다 적게 할당합니다.') +
            ' 구현체와 입력 조건은 동일하게 유지합니다.';
        $('baseline-tables').innerHTML = s.ops
            .map((op) => {
                const body = IMPLS.flatMap((impl) =>
                    DIGITS.map((d) => {
                        const base = get(s.base, d, impl, op)[s.metric];
                        return (
                            '<tr>' +
                            cell(`${esc(NAMES[impl])} · ${fmt(d, 0)}자리`) +
                            VERSIONS.map((v) => {
                                const value = get(v, d, impl, op)[s.metric],
                                    r = ratio(base, value),
                                    cls = value < base ? 'good' : value > base ? 'slow' : '';
                                return cell(
                                    s.metric === 'ns_op' ? rf(r) : signed(value - base),
                                    cls
                                );
                            }).join('') +
                            '</tr>'
                        );
                    })
                );
                return panel(
                    opName(op),
                    s.metric === 'ns_op'
                        ? '시간 개선 배율 (높을수록 좋음)'
                        : '할당량 증감 B/op (낮을수록 좋음)',
                    table(
                        [
                            '구현체 · 자릿수',
                            ...VERSIONS.map((v) => esc(v) + (v === s.base ? ' [기준]' : '')),
                        ],
                        body
                    )
                );
            })
            .join('');
    }
    function renderGrowth(s) {
        const steps = DIGITS.slice(1).map((d, i) => [DIGITS[i], d]);
        if (DIGITS.length > 2) steps.push([DIGITS[0], DIGITS.at(-1)]);
        $('growth-tables').innerHTML = s.ops
            .map((op) => {
                const body = VERSIONS.flatMap((v) =>
                    IMPLS.map(
                        (impl) =>
                            '<tr>' +
                            cell(`${esc(v)} · ${esc(NAMES[impl])}`) +
                            steps
                                .map(([from, to]) =>
                                    cell(
                                        rf(
                                            ratio(
                                                get(v, to, impl, op)[s.metric],
                                                get(v, from, impl, op)[s.metric]
                                            )
                                        )
                                    )
                                )
                                .join('') +
                            '</tr>'
                    )
                );
                return panel(
                    opName(op),
                    measureName(s) + ' 증가 배율',
                    steps.length
                        ? table(
                              [
                                  '버전 · 구현체',
                                  ...steps.map(([a, b]) => fmt(a, 0) + ' → ' + fmt(b, 0) + '자리'),
                              ],
                              body
                          )
                        : '<p>두 개 이상의 자릿수가 있어야 증가율을 비교할 수 있습니다.</p>'
                );
            })
            .join('');
    }
    function renderRanking(s) {
        $('ranking-cards').innerHTML = s.ops
            .flatMap((op) =>
                DIGITS.map((d) => {
                    const rows = ROWS.filter((r) => r.digits === d && r.operation === op).sort(
                        (a, b) =>
                            a[s.metric] - b[s.metric] ||
                            frameworkOrder(a.framework) - frameworkOrder(b.framework)
                    );
                    const top = rows.slice(0, 3);
                    const body = top
                        .map((r, i) => {
                            const rank = rows.filter((x) => x[s.metric] < r[s.metric]).length + 1;
                            const difference = r[s.metric] - top[0][s.metric];
                            const description =
                                difference === 0
                                    ? i === 0
                                        ? '최저 비용'
                                        : '공동 최저 비용'
                                    : `최저 대비 +${fmt(difference)} ${unit(s)}`;
                            return /* HTML */ `<div class="rank">
                                <b>${rank}</b>
                                <div>
                                    <strong
                                        >${esc(r.framework)} ·
                                        ${esc(NAMES[r.implementation])}</strong
                                    ><small>${fmt(r[s.metric])} ${unit(s)} · ${description}</small>
                                </div>
                            </div>`;
                        })
                        .join('');
                    return panel(
                        `${fmt(d, 0)}자리 · ${opName(op)}`,
                        measureName(s) + ' 오름차순 · 상위 3개',
                        body
                    );
                })
            )
            .join('');
    }
    function renderExplorer(s) {
        const v = $('filter-version').value,
            d = $('filter-digits').value,
            i = $('filter-impl').value;
        const rows = ROWS.filter(
            (r) =>
                s.ops.includes(r.operation) &&
                (v === 'all' || r.framework === v) &&
                (d === 'all' || r.digits === Number(d)) &&
                (i === 'all' || r.implementation === i)
        );
        const value = (r) =>
            sortKey === 'framework'
                ? frameworkOrder(r.framework)
                : sortKey === 'throughput'
                  ? 1000 / r.ns_op
                  : r[sortKey];
        rows.sort((a, b) => {
            const x = value(a),
                y = value(b);
            return (
                (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * sortDirection
            );
        });
        $('raw-body').innerHTML =
            rows
                .map(
                    (r) =>
                        '<tr>' +
                        [
                            esc(r.framework),
                            fmt(r.digits, 0),
                            esc(NAMES[r.implementation]),
                            esc(r.operation),
                            fmt(r.ns_op),
                            fmt(r.bytes_op, 1),
                            fmt(1000 / r.ns_op),
                            fmt(r.samples, 0),
                        ]
                            .map((x) => cell(x))
                            .join('') +
                        '</tr>'
                )
                .join('') || '<tr><td colspan="8">일치하는 데이터가 없습니다.</td></tr>';
        $('explorer-count').textContent = `${rows.length} / ${ROWS.length}개 측정값`;
        document.querySelectorAll('[data-sort]').forEach((b) => {
            b.textContent =
                {
                    framework: '버전',
                    digits: '자릿수',
                    implementation: '구현체',
                    operation: '연산',
                    ns_op: 'ns/op',
                    bytes_op: 'B/op',
                    throughput: '백만 연산/초',
                    samples: '회/표본',
                }[b.dataset.sort] +
                (b.dataset.sort === sortKey ? (sortDirection === 1 ? ' ↑' : ' ↓') : ' ↕');
            b.closest('th').setAttribute(
                'aria-sort',
                b.dataset.sort === sortKey
                    ? sortDirection === 1
                        ? 'ascending'
                        : 'descending'
                    : 'none'
            );
        });
    }
    function renderEnvironment() {
        const environment = DATA.environment;
        const linked = DATA.runtimes.filter((runtime) => runtime.environment_verified);
        const target = $('test-environment');
        if (!environment || linked.length === 0) {
            target.textContent =
                '이 측정 로그에 연결된 환경 기록이 없습니다. ' +
                'run.ps1로 다시 측정한 뒤 node report.js를 실행하면 표시됩니다.';
            return;
        }

        const display = (value) =>
            value === null || value === undefined || value === '' ? '미수집' : esc(value);
        const gib = (value) =>
            typeof value === 'number' && value > 0 ? `${fmt(value / 1024 ** 3)} GiB` : '미수집';
        const memory = environment.memory || {};
        const modules = memory.modules || [];
        const cpu = (environment.cpu || []).map((processor) => {
            return [
                display(processor.name),
                `${display(processor.physical_cores)}코어 / ` +
                    `${display(processor.logical_processors)}논리 프로세서`,
                `WMI 보고 클럭 ${display(processor.max_clock_mhz)} MHz`,
            ].join(' · ');
        });
        const installedBytes = modules.reduce((total, module) => total + module.capacity_bytes, 0);
        const settings = Object.entries(environment.dotnet?.environment_variables || {});
        const fields = [
            ['수집 시각', display(environment.started_at)],
            ['측정 종료', display(environment.finished_at)],
            ['시간대', display(environment.timezone)],
            ['연결된 측정 로그', linked.map((runtime) => esc(runtime.framework)).join(', ')],
            ['CPU', cpu.join('<br>') || '미수집'],
            ['설치 RAM (모듈 용량 합계)', gib(installedBytes)],
            ['OS가 보고한 물리 메모리', gib(memory.total_bytes)],
            ['측정 시작 시 사용 가능 메모리', gib(memory.available_bytes_at_start)],
            [
                '하드웨어',
                [
                    display(environment.hardware?.manufacturer),
                    display(environment.hardware?.model),
                ].join(' / '),
            ],
            [
                '운영체제',
                [
                    display(environment.os?.name),
                    display(environment.os?.architecture),
                    `버전 ${display(environment.os?.version)}`,
                    `빌드 ${display(environment.os?.build)}`,
                ].join(' · '),
            ],
            ['전원 계획', display(environment.power_plan)],
            ['.NET SDK', display(environment.dotnet?.sdk_version)],
            ['PowerShell', display(environment.runner?.powershell_version)],
            [
                '빌드 / 실행 방식',
                [
                    display(environment.benchmark?.configuration),
                    display(environment.benchmark?.compilation),
                ].join(' / '),
            ],
            ['기본 반복 횟수', display(environment.benchmark?.iterations)],
            [
                '명시적 .NET 환경 변수',
                settings.length
                    ? settings.map(([name, value]) => `${esc(name)}=${esc(value)}`).join('<br>')
                    : '별도 설정 없음 (런타임 기본값)',
            ],
        ];
        const summary = table(
            ['항목', '측정 환경'],
            fields.map(([name, value]) => '<tr>' + cell(esc(name)) + cell(value) + '</tr>')
        );
        const moduleTable = modules.length
            ? table(
                  ['RAM 모듈', '용량', '보고 속도', '설정 속도'],
                  modules.map(
                      (module, index) =>
                          '<tr>' +
                          cell(index + 1) +
                          cell(gib(module.capacity_bytes)) +
                          cell(display(module.speed_mhz)) +
                          cell(display(module.configured_speed_mhz)) +
                          '</tr>'
                  )
              )
            : '<p>메모리 모듈 정보를 수집하지 못했습니다.</p>';
        const runtimes = (environment.dotnet?.installed_runtimes || [])
            .map((runtime) => `<li>${esc(runtime)}</li>`)
            .join('');
        const warnings = (environment.collection_warnings || [])
            .map((warning) => `<li>${esc(warning)}</li>`)
            .join('');
        target.innerHTML =
            summary +
            '<p class="muted compact">클럭과 RAM 속도는 펌웨어/WMI 보고값이며 실측 주파수가 아닙니다. ' +
            '사용 가능 메모리는 시작 시점의 스냅샷이며 측정 프로그램의 사용량이 아닙니다. ' +
            '환경은 실행 ID와 로그 해시가 일치하는 측정에만 연결합니다.</p>' +
            `<details><summary>메모리 모듈 상세</summary>${moduleTable}</details>` +
            `<details><summary>설치된 .NET 런타임</summary><ul>${runtimes}</ul></details>` +
            (warnings
                ? `<details><summary>수집하지 못한 정보</summary><ul>${warnings}</ul></details>`
                : '');
    }

    function renderInputs() {
        $('inputs').innerHTML = table(
            ['대상 파일', '실행 런타임', '검증 통과 쌍', '표본 설명', '환경 기록'],
            DATA.runtimes.map(
                (r) =>
                    '<tr>' +
                    cell(esc(r.framework + '.txt')) +
                    cell(esc(r.runtime)) +
                    cell(fmt(r.checks, 0)) +
                    cell(esc(r.iterations)) +
                    cell(r.environment_verified ? '확인됨' : '없음 / 불일치') +
                    '</tr>'
            )
        );
        $('footer').textContent =
            `생성 시각: ${DATA.generated_at} · ${VERSIONS.length}개 런타임 / ${ROWS.length}개 측정값 · ` +
            'Node.js · 인터넷 연결 없이 사용 가능 · ' +
            `CSV의 버전 비교 기준은 ${VERSIONS[0]}로 고정됩니다.`;
    }
    function render() {
        const s = state();
        renderOverview(s);
        renderDigits(s);
        renderVersions(s);
        renderImplementations(s);
        renderHeatmap(s);
        renderBaseline(s);
        renderGrowth(s);
        renderRanking(s);
        renderExplorer(s);
    }
    fillOptions('baseline-select', VERSIONS, false);
    fillOptions('filter-version', VERSIONS, true);
    fillOptions('filter-digits', DIGITS, true);
    ['metric', 'operation', 'scale', 'baseline-select'].forEach((id) =>
        $(id).addEventListener('change', render)
    );
    ['filter-version', 'filter-digits', 'filter-impl'].forEach((id) =>
        $(id).addEventListener('change', () => renderExplorer(state()))
    );
    document.querySelectorAll('[data-sort]').forEach((b) =>
        b.addEventListener('click', () => {
            if (sortKey === b.dataset.sort) sortDirection *= -1;
            else {
                sortKey = b.dataset.sort;
                sortDirection = 1;
            }
            renderExplorer(state());
        })
    );
    $('reset-filters').addEventListener('click', () => {
        ['filter-version', 'filter-digits', 'filter-impl'].forEach((id) => ($(id).value = 'all'));
        renderExplorer(state());
    });
    $('print').addEventListener('click', () => window.print());
    try {
        renderEnvironment();
        renderInputs();
        render();
        $('data-error').hidden = true;
    } catch (error) {
        $('data-error').textContent =
            '리포트를 표시하지 못했습니다. node report.js로 데이터를 다시 생성하세요. (' +
            error.message +
            ')';
    }
})();
