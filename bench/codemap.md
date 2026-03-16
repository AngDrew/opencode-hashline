# bench/

## Responsibility

- Hosts the benchmark harness for this plugin.
- Defines deterministic benchmark scenarios and quality gates.

## Files

- `bench/runner.mjs`
  - Runs performance microbenchmarks for hashline operations.
  - Runs correctness scenarios for ref and fileRev behavior.
  - Prints p50/p95/p99 and pass/fail gate output.

- `bench/cases.json`
  - Configurable benchmark matrix:
    - performance sizes/operations/warmup/iterations
    - correctness scenario list with expected results
    - gate thresholds (`correctnessPassRate`, `wrongToolRate`, `maxP95RegressionPercent`)

## Execution

- Primary command: `npm run bench`
- Optional overrides:
  - `BENCH_WARMUP`
  - `BENCH_ITERATIONS`
- Legacy script for comparison: `npm run bench:legacy`