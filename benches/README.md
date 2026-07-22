# Operation benchmarks

The operation benchmark covers exactly four Prettier formatting cases: explicit
and automatic selection at shallow and nested virtual destination paths. It
never creates those destination files.

Record a baseline before changing the call path:

```sh
deno run -A benches/measure_operation.ts --batches 3 --iterations 30 \
  --output /tmp/projectfmt-operation-baseline.json
deno bench -A benches/operation_bench.ts
```

Compare a candidate in the same checkout and environment:

```sh
deno run -A benches/measure_operation.ts --batches 3 --iterations 30 \
  --baseline /tmp/projectfmt-operation-baseline.json \
  --output /tmp/projectfmt-operation-candidate.json
```

The comparison rejects any scenario whose median-of-medians regresses by more
than 5%. Call-count tests provide the deterministic proof that duplicated work
was removed; timings are supporting evidence.

## Measurements

Plan 014 was measured on Deno 2.9.3, Linux x86-64, on an Intel Core Ultra 9
285HX. Values are median-of-medians in milliseconds from three batches of 30
operations after five warmups.

| Scenario         | Baseline | Retained operation stage | Change |
| ---------------- | -------: | -----------------------: | -----: |
| explicit-shallow |    2.992 |                    2.626 | -12.2% |
| explicit-nested  |    5.730 |                    5.292 |  -7.6% |
| auto-shallow     |    3.374 |                    2.686 | -20.4% |
| auto-nested      |    4.853 |                    4.687 |  -3.4% |

The operation stage was retained: deterministic tests reduce adapter-map
construction and selected probing/resolution from two to one, and no scenario
regressed beyond the 5% limit in the recorded comparison.

A second stage shared package/config reads within the call. It was rejected and
reverted because it did not meet the requirement that both automatic scenarios
improve by at least 10%; a repeat sample also regressed `auto-nested` by 51.5%
(4.853 ms to 7.353 ms). No discovery-read cache remains in the implementation.
