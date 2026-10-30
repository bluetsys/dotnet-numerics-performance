'use strict';

// node report.js [--results PATH]
// Generates data and CSV only. report/report.html is a static viewer.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const IMPLEMENTATIONS = ['Fast', '.NET'];
const OPERATIONS = ['+', '*'];
const OUTPUT = path.join(__dirname, 'report');

function parse(file) {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const runtime = /^Runtime: (.+)$/m.exec(text);
    const iterations = /^Iterations: (.+)$/m.exec(text);
    const correctness = /^Correctness: ([\d,]+) pairs \+ default zero passed\.$/m.exec(text);
    const environmentId = /^Environment ID: (.+)$/m.exec(text);
    if (!runtime || !iterations || !correctness || text.includes('Exit code:')) {
        throw new Error(`Incomplete or failed benchmark: ${file}`);
    }
    const framework = path.basename(file, '.txt');
    const rows = [], sections = new Set(), keys = new Set();
    let digits, samples;
    for (const line of text.split('\n')) {
        const section = /^(\d+) decimal digits \(([\d,]+) operations\/sample\)$/.exec(line);
        if (section) {
            digits = Number(section[1]);
            samples = Number(section[2].replaceAll(',', ''));
            if (!Number.isSafeInteger(digits) || digits <= 0 || !Number.isSafeInteger(samples) || samples <= 0 || sections.has(digits)) {
                throw new Error(`Invalid or duplicate section: ${file}: ${line}`);
            }
            sections.add(digits);
        }
        const measurement = /^(Fast|\.NET)\s+([+*])\s+([\d.]+) ns\/op\s+([\d.]+) B\/op$/.exec(line);
        if (measurement) {
            const [, implementation, operation] = measurement;
            const ns = Number(measurement[3]), allocation = Number(measurement[4]);
            const key = [digits, implementation, operation].join('|');
            if (digits === undefined || !Number.isFinite(ns) || ns <= 0 || !Number.isFinite(allocation) || allocation < 0 || keys.has(key)) {
                throw new Error(`Invalid or duplicate measurement: ${file}: ${line}`);
            }
            keys.add(key);
            rows.push({
                framework, runtime: runtime[1].trim(), digits, samples,
                implementation, operation, ns_op: ns, bytes_op: allocation
            });
        } else if (line.includes('ns/op') || line.includes('B/op')) {
            throw new Error(`Unrecognized measurement: ${file}: ${line}`);
        }
    }
    if (sections.size === 0 || rows.length !== sections.size * IMPLEMENTATIONS.length * OPERATIONS.length) {
        throw new Error(`Missing measurements: ${file}`);
    }
    const checks = Number(correctness[1].replaceAll(',', ''));
    if (!Number.isSafeInteger(checks) || checks <= 0) throw new Error(`Invalid correctness count: ${file}`);
    return {
        framework, runtime: runtime[1].trim(), iterations: iterations[1].trim(), checks,
        environment_id: environmentId ? environmentId[1].trim() : null,
        digits: [...sections].sort((a, b) => a - b), rows
    };
}

function analyze(data) {
    const key = (v, d, i, o) => [v, d, i, o].join('|');
    const index = new Map(data.flatMap(item => item.rows.map(row =>
        [key(row.framework, row.digits, row.implementation, row.operation), row])));
    const comparisons = [], versions = [], baseline = data[0].framework;
    for (const item of data) for (const digits of item.digits) for (const operation of OPERATIONS) {
        const fast = index.get(key(item.framework, digits, 'Fast', operation));
        const net = index.get(key(item.framework, digits, '.NET', operation));
        comparisons.push({
            framework: item.framework, digits, operation,
            fast_ns: fast.ns_op, biginteger_ns: net.ns_op, fast_speedup: net.ns_op / fast.ns_op,
            fast_bytes: fast.bytes_op, biginteger_bytes: net.bytes_op,
            allocation_saved_bytes: net.bytes_op - fast.bytes_op
        });
        for (const implementation of IMPLEMENTATIONS) {
            const row = index.get(key(item.framework, digits, implementation, operation));
            const base = index.get(key(baseline, digits, implementation, operation));
            versions.push({
                baseline, framework: item.framework, digits, operation, implementation,
                ns_op: row.ns_op, baseline_ns: base.ns_op, speedup_vs_baseline: base.ns_op / row.ns_op,
                bytes_op: row.bytes_op, allocation_delta_bytes: row.bytes_op - base.bytes_op
            });
        }
    }
    return { comparisons, versions };
}

function csv(rows) {
    const headers = Object.keys(rows[0]);
    const escape = value => {
        const text = String(value ?? '');
        return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    return '\uFEFF' + [headers.map(escape).join(','), ...rows.map(row =>
        headers.map(header => escape(row[header])).join(','))].join('\r\n') + '\r\n';
}

function compareFrameworks(a, b) {
    const left = a.match(/\d+/g).map(Number), right = b.match(/\d+/g).map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const difference = (left[i] ?? 0) - (right[i] ?? 0);
        if (difference) return difference;
    }
    return a.localeCompare(b);
}

function generate(resultsDirectory, outputDirectory = OUTPUT) {
    const files = fs.readdirSync(resultsDirectory, { withFileTypes: true })
        .filter(entry => entry.isFile() && /^net\d+(?:\.\d+)*\.txt$/.test(entry.name))
        .map(entry => entry.name).sort(compareFrameworks);
    if (files.length === 0) throw new Error(`No benchmark results: ${resultsDirectory}`);
    const data = files.map(name => parse(path.join(resultsDirectory, name)));
    if (data.some(item => JSON.stringify(item.digits) !== JSON.stringify(data[0].digits))) {
        throw new Error('Runtime files have different digit sections; rerun all frameworks with matching inputs.');
    }
    const rows = data.flatMap(item => item.rows);
    const { comparisons, versions } = analyze(data);
    const environmentPath = path.join(resultsDirectory, 'environment.json');
    let environment = null;
    if (fs.existsSync(environmentPath)) {
        environment = JSON.parse(fs.readFileSync(environmentPath, 'utf8').replace(/^\uFEFF/, ''));
        if (environment.schema_version !== 1 || typeof environment.run_id !== 'string') {
            throw new Error('Unsupported environment.json format. Rerun run.ps1 to collect the environment.');
        }
    }
    for (const item of data) {
        const file = `${item.framework}.txt`;
        const expectedHash = environment?.result_files?.[file];
        const actualHash = crypto.createHash('sha256').update(
            fs.readFileSync(path.join(resultsDirectory, file))
        ).digest('hex');
        item.environment_verified = Boolean(
            environment && item.environment_id === environment.run_id &&
            typeof expectedHash === 'string' && actualHash.toLowerCase() === expectedHash.toLowerCase()
        );
    }
    const payload = {
        runtimes: data.map(({ rows, ...metadata }) => metadata), rows, comparisons,
        environment,
        generated_at: new Date().toISOString()
    };
    const encoded = JSON.stringify(payload, null, 2)
        .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    fs.mkdirSync(outputDirectory, { recursive: true });
    // No HTML is read, written, copied, or generated here.
    fs.writeFileSync(path.join(outputDirectory, 'measurements.js'),
        '// Generated by report.js. Refresh with: node report.js\nwindow.BENCHMARK_DATA = ' + encoded + ';\n', 'utf8');
    fs.writeFileSync(path.join(outputDirectory, 'measurements.csv'), csv(rows), 'utf8');
    fs.writeFileSync(path.join(outputDirectory, 'implementation-comparison.csv'), csv(comparisons), 'utf8');
    fs.writeFileSync(path.join(outputDirectory, 'version-comparison.csv'), csv(versions), 'utf8');
    return payload;
}

function main(args) {
    let resultsDirectory = path.join(__dirname, 'results');
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--help' || args[i] === '-h') {
            console.log('Usage: node report.js [--results PATH]\nWrites measurements.js and CSV files to report/. Does not generate HTML.');
            return;
        }
        if (args[i] !== '--results' || !args[i + 1] || args[i + 1].startsWith('--')) {
            throw new Error(`Invalid argument: ${args[i]}. Usage: node report.js [--results PATH]`);
        }
        resultsDirectory = path.resolve(args[++i]);
    }
    const payload = generate(resultsDirectory);
    console.log(`Parsed ${payload.runtimes.length} runtimes, ${payload.rows.length} measurements, ${payload.comparisons.length} comparisons.`);
    console.log(`Fast time wins: ${payload.comparisons.filter(row => row.fast_speedup > 1).length}/${payload.comparisons.length}`);
    console.log(`Data: ${path.join(OUTPUT, 'measurements.js')}`);
    console.log(`Open: ${path.join(OUTPUT, 'index.html')}`);
}

if (require.main === module) {
    try { main(process.argv.slice(2)); }
    catch (error) { console.error(`Report error: ${error.message}`); process.exitCode = 1; }
}
module.exports = { parse, analyze, csv, compareFrameworks, generate };
