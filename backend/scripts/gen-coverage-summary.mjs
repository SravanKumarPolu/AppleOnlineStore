// Regenerates coverage/coverage-summary.json from the fresh
// coverage/coverage-final.json produced by `npm run test:coverage` —
// the default jest coverage reporters (json/text/lcov/clover) do not
// emit the json-summary file, so this keeps the archived summary in
// sync without re-running the suite.
//
// Usage: node scripts/gen-coverage-summary.mjs
import fs from 'node:fs';
import path from 'node:path';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const finalPath = path.join(root, 'coverage', 'coverage-final.json');
const summaryPath = path.join(root, 'coverage', 'coverage-summary.json');

const coverage = libCoverage.createCoverageMap(
  JSON.parse(fs.readFileSync(finalPath, 'utf8'))
);
const context = libReport.createContext({
  coverageMap: coverage,
  dir: path.join(root, 'coverage'),
  watermarks: {},
});
const report = reports.create('json-summary', { file: 'coverage-summary.json' });
report.execute(context);

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const total = summary.total || Object.values(summary).find((v) => v && v.lines);
console.log(
  `coverage-summary.json regenerated: total lines ${total.lines.pct}% branches ${total.branches.pct}% across ${Object.keys(summary).length - 1} files`
);
