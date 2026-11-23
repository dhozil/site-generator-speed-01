# site-generator-speed-01

A faster drop-in for make.fun's `makefun-site 1.0.0`: `solve.js` returns the same
output tree for every case, byte for byte, and does it in a fraction of the CPU time.

[![bounty](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/dhozil/site-generator-speed-01/rank.svg)
![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/dhozil/site-generator-speed-01/reward.svg)

Entry for <https://make.fun/bounty/site-generator-speed-01-run-20261122>.

## What it does

`main.ts` is the harness's driver: it reads every case from `/input/cases.json`,
answers each with `run()` from `solve.js`, and writes `/output/answers.json`.
`solve.js` does the work: front matter, its own Markdown subset, the template
dialect, permalinks, tags, index pages, the report.
