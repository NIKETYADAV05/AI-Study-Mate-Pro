# MCQ Distractor Reuse Fix — Semantic Code Review (Round 2)

This round applies the two fixes identified in the prior review pass: making the
`used_distractors` alias a shallow copy to prevent silent mutation of the caller's
reservation dict, and adding `skipTest` guards to the two notorious-phrase test methods
so they report honestly when their target question type wasn't generated rather than
passing vacuously with zero assertions.

Watch for: the `skipTest` path in `test_notorious_phrase_not_distractor_for_database_instance`
and `test_notorious_phrase_not_distractor_for_dba` is correct behavior given the
`_DBMS_REUSE_SOURCE` pool size, but it means those two tests have never asserted
anything in any run seen so far (confirmed: both skipped in the reported test output).
The cross-question reservation and hard relevance filter — the primary fixes from
round 1 — are not directly exercised by any test that currently runs without skipping.
`test_cross_question_reuse_bounded` is the only consistently-running guard for the
core fix.

**Verdict**: APPROVED

---

## High-level view

The shallow-copy fix (`dict(used_distractors)` instead of a live alias) is correct and
eliminates the write-aliasing risk. The current code never writes to `_reserved` inside
`_build_distractor_pool`, so the fix is defensive rather than fixing an observed
mutation — but it's the right defensive posture and costs one dict allocation per
question.

The `skipTest` fix in both notorious-phrase tests is structurally correct. The prior
`for q in mcqs: if "<stem>" not in q["question"].lower(): continue` pattern could
complete the loop with zero assertions executed, silently passing. The new pattern
collects target questions first and calls `self.skipTest(...)` if none are found — the
same pattern already used in `test_directly_maintained_not_distractor_for_database_question`.
The tradeoff is that both tests now skip every run against `_DBMS_REUSE_SOURCE` because
that source doesn't generate those specific question types in the top 5 MCQs. This is
honest but means the notorious-phrase guard has zero runtime coverage on the regression
source.

The bucket-split + independent relevance sort (`pref_part` / `fall_part`) ensures
preferred (not-yet-used) candidates always rank above fallback candidates regardless of
per-candidate relevance score. The fallback sort by `(_reserved.get(c.lower(), 0),
-_relevance(c))` — ascending use-count then descending relevance — is the right
tie-breaker. The hard relevance filter applies in both the main and supplement loops;
its practical effect on pure DBMS material is limited because the shared word "database"
gives every DBMS candidate non-zero overlap with every DBMS question stem. It does
meaningful work for mixed-domain sources.

<details>
<summary>Issues (2)</summary>

1. **Notorious-phrase tests always skip on `_DBMS_REUSE_SOURCE`** — `test_notorious_phrase_not_distractor_for_database_instance` and `test_notorious_phrase_not_distractor_for_dba` have never asserted anything in any recorded run (both skipped per the test report). The source contains the relevant sentences ("A database instance is…", "The Database Administrator (DBA) is…") but the top-5 MCQ generator doesn't always pick them. A deterministic fixture or a direct call to `_build_mcq` on the specific sentence would make these tests reliably asserting rather than reliably skipping. Severity: **LOW** — the test infrastructure is honest (skip > silent pass), and `test_cross_question_reuse_bounded` does exercise the reservation path.

2. **`test_cross_question_reuse_bounded` allows ≤ 2 reuses but the core fix is meant to achieve ≤ 1** — the bound is documented as conservative due to pool-size arithmetic (9 candidates, 15 draws). The test comment explains this correctly. The bound cannot be tightened without expanding `_DBMS_REUSE_SOURCE`, which is a test-data concern, not a production bug. Severity: **LOW** (non-blocking, documented).

</details>

<details>
<summary>Details</summary>

### Shallow copy prevents future aliasing in `_build_distractor_pool`

The prior implementation assigned `_reserved = used_distractors` when the argument was
a `dict`, creating a live alias. Any future write to `_reserved` inside the function
would silently mutate the caller's cross-quiz reservation dict in `_build_mcq`, skewing
distractor counts for all subsequent questions in the quiz run. The fix — `_reserved =
dict(used_distractors)` — eliminates the aliasing with one allocation. The function
currently only reads `_reserved`, so this fixes a latent risk rather than an active
bug, but it's the correct defensive pattern. Confirmed at views.py ~1355–1360.

### Notorious-phrase tests: correct pattern, zero runtime coverage (LOW)

Both `test_notorious_phrase_not_distractor_for_database_instance` and
`test_notorious_phrase_not_distractor_for_dba` now use the pre-collection + `skipTest`
guard introduced in the prior `test_directly_maintained_not_distractor_for_database_question`.
The pattern is correct — skipping is more honest than silently passing.

The problem is that `_DBMS_REUSE_SOURCE` contains both target sentences ("A database
instance is the data in the database at a particular moment in time." and "The Database
Administrator (DBA) is a person who manages and maintains the database."), so in
principle the questions can be generated. In practice, the top-5 scorer doesn't always
include them — as confirmed by the test report showing both tests skipped. The tests
have never asserted anything in any recorded run.

The fix for this would be to call `_build_mcq` directly on the known sentences rather
than relying on `_assemble_quiz`'s scoring to pick them. Example:

```python
from api.views import _build_mcq, clean_text, split_into_sentences, compute_freq

source = _DBMS_REUSE_SOURCE
sents  = split_into_sentences(clean_text(source))
freq   = compute_freq(sents)
target_sentence = next(
    s for s in sents if "database instance" in s.lower()
)
q = _build_mcq(target_sentence, sents, freq, "medium", set(), {})
self.assertIsNotNone(q)
notorious = "one of the most widely used database models"
for opt in q["options"]:
    if opt.strip().lower() != q["correct_answer"].strip().lower():
        self.assertNotIn(notorious, opt.lower())
```

This approach is deterministic and doesn't depend on scoring order. Implementing it is
low priority since `test_cross_question_reuse_bounded` already covers the core
reservation path, but the skip signal should be acknowledged as a coverage gap.

### `test_cross_question_reuse_bounded` — the only consistently-running guard

This test collects all distractor strings across all MCQs and asserts each appears in
≤ 2 questions. With `_DBMS_REUSE_SOURCE` yielding ~9 candidates and 5 questions × 3
distractors = 15 draws, the bound is mathematically necessary: at least 6 reuses are
forced even with perfect reservation. The test comment explains this arithmetic
correctly. The bound is conservatively set at ≤ 2, meaning a distractor appearing in
3+ questions is a hard failure. This does provide meaningful coverage of the reservation
path — if the `used_distractors` dict were removed from `_assemble_quiz`, the most
popular candidates would appear in all 5 questions and this test would fail.

The non-vacuousness guard (`assertGreaterEqual(len(mcqs), 3)`) is present on every
assertion method in `DistractorReuseFixTest`. Confirmed.

### `test_cross_question_reuse_bounded` is the only consistently-running guard for the core reservation fix

The non-vacuousness guard (`assertGreaterEqual(len(mcqs), 3)`) is present on every
assertion method in `DistractorReuseFixTest`. `test_cross_question_reuse_bounded`
collects all distractor strings across all MCQs and asserts each appears in ≤ 2
questions. If the `used_distractors` dict were removed from `_assemble_quiz`, the most
popular candidates would appear in all 5 questions and this test would fail. That makes
it the one test that meaningfully catches a regression in the core fix.

</details>

---

<details>
<summary>File map</summary>

| File | What changed |
|---|---|
| `backend/api/views.py` | `_build_distractor_pool`: `_reserved = used_distractors` → `_reserved = dict(used_distractors)` (prevents future aliasing of the caller's reservation dict) |
| `backend/api/tests.py` | `DistractorReuseFixTest.test_notorious_phrase_not_distractor_for_database_instance` and `test_notorious_phrase_not_distractor_for_dba`: replaced `for`-with-`continue` pattern with pre-collection + `self.skipTest(...)` guard |

Full diff: `git diff main -- backend/api/views.py backend/api/tests.py`

</details>
