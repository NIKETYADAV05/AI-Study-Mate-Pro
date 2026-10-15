# Distractor Fix Report

**Date:** 2025  
**Step:** Review-findings fix (round 2 of distractor reuse fix)

---

## 1. Root cause

The two root-cause bugs addressed in the prior round — no cross-question `used_distractors` reservation in `_assemble_quiz` and a soft (non-hard) relevance filter in `_build_distractor_pool` — were already fixed in the previous implementation. This round addressed the two remaining **review findings** identified in `distractor-fix-review.json`:

**Finding 1 (MEDIUM):** `test_notorious_phrase_not_distractor_for_database_instance` (around line 593) and `test_notorious_phrase_not_distractor_for_dba` (around line 615) in `tests.py` used a `for q in mcqs: if "<stem>" not in q["question"].lower(): continue` pattern with no `self.skipTest(...)` fallback. If the generator did not produce a "database instance" or "DBA/Database Administrator" question among the 5 MCQs, both loops completed with zero assertions executed — a vacuously-passing test that would give false confidence.

**Finding 2 (LOW):** In `_build_distractor_pool` (views.py), the line `_reserved = used_distractors` when `used_distractors` is a `dict` created a live alias. Any future write to `_reserved` inside that function would silently corrupt the caller's cross-quiz reservation dict in `_build_mcq`, breaking distractor tracking for all subsequent questions in the quiz run.

---

## 2. Approach chosen and why

**Finding 1 fix:** Replaced the `for`-with-`continue` pattern in both notorious-phrase tests with a pre-collection step:
```python
target_questions = [q for q in mcqs if "<stem>" in q["question"].lower()]
if not target_questions:
    self.skipTest("... cannot test (test would be vacuous).")
for q in target_questions:
    # assertions
```
This is the same pattern already used in `test_directly_maintained_not_distractor_for_database_question`. The `skipTest` approach is correct here because if the source text doesn't generate the specific question type, the test has no input to validate against — skipping is the honest signal rather than silently passing with zero assertions.

**Finding 2 fix:** Changed `_reserved = used_distractors` to `_reserved = dict(used_distractors)` — a shallow copy. This costs one dict allocation per question (~negligible) and eliminates the aliasing risk entirely without changing any observable behavior (the function only reads `_reserved`, never writes to it in current code).

---

## 3. Files changed and exact changes

### `backend/api/views.py`

**Change:** In `_build_distractor_pool`, replaced live alias with shallow copy.

```python
# Before:
        if isinstance(used_distractors, dict):
            # read-only alias — writes to used_distractors happen in _build_mcq
            # after pool construction. Do NOT write to _reserved here; doing so
            # would corrupt the caller's cross-quiz reservation dict.
            _reserved = used_distractors

# After:
        if isinstance(used_distractors, dict):
            # Shallow copy so that any future write to _reserved inside this
            # function cannot corrupt the caller's cross-quiz reservation dict.
            # Reads are still O(1) — only one dict allocation per question.
            _reserved = dict(used_distractors)
```

### `backend/api/tests.py`

**Change 1:** `test_notorious_phrase_not_distractor_for_database_instance` — replaced loop-with-continue with pre-collection + `skipTest` guard.

**Change 2:** `test_notorious_phrase_not_distractor_for_dba` — same pattern applied.

Both tests now call `self.skipTest(...)` when the specific question type isn't generated, rather than silently passing with zero assertions.

---

## 4. Verbatim terminal output from all 4 commands

### `python manage.py check`
```
System check identified no issues (0 silenced).
```

### `python manage.py makemigrations --check`
```
No changes detected
```

### `python manage.py test api`
```
Found 25 test(s).
Creating test database for alias 'default'...
System check identified no issues (0 silenced).
..s....................s.
----------------------------------------------------------------------
Ran 25 tests in 0.210s
OK (skipped=2)
Destroying test database for alias 'default'...
```

The 2 skips are the newly-fixed notorious-phrase tests (`test_notorious_phrase_not_distractor_for_database_instance` and `test_notorious_phrase_not_distractor_for_dba`) — the `_DBMS_REUSE_SOURCE` generator produced 5 MCQs but not the specific question types those tests look for in this run. The `skipTest` guard is working correctly: instead of silently passing with zero assertions, the tests now honestly report that they could not find their target question type and skip.

### `npm run build`
```
> frontend@0.1.0 build
> next build

▲ Next.js 16.4.0 (Turbopack)
✓ Compiled successfully in 831ms
✓ Collecting page data using 12 workers in 2.0s
✓ Generating static pages using 12 workers (11/11) in 2.6s
✓ Finalizing page optimization in 40ms

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /boss
├ ○ /notes
├ ○ /nova
├ ○ /planner
├ ○ /progress
├ ○ /quiz
└ ○ /summarizer
```

---

## 5. Browser testing

**Browser testing is still recommended** for the end-to-end MCQ distractor quality improvements implemented in the prior round. Specifically:

- Generate a 5-question DBMS quiz using the same kind of notes text the user pasted (including sentences about database instance, DBA, schema, relational model).
- Verify that "one of the most widely used database models" no longer appears as a distractor in the database instance or DBA question.
- Verify that "directly maintained in the database" (or the DBA-role phrase) no longer repeats across multiple questions.
- Verify that each question's distractors feel topically related to that question, not generic DBMS boilerplate.

The backend tests validate structural correctness and bounded reuse; browser testing validates the subjective quality improvement the user originally reported.

---

## 6. Remaining limitations

1. **Pool size vs. demand:** `_DBMS_REUSE_SOURCE` yields ~9 usable distractor candidates for 5 questions × 3 distractors = 15 total draws. Even with perfect cross-question reservation, ~6 distractors must be reused (15 draws – 9 unique candidates). The `test_cross_question_reuse_bounded` test uses ≤2 as a conservative bound. With longer, richer source text the reuse drops naturally.

2. **Notorious-phrase tests skip rather than assert:** The `skipTest` behavior is correct given the pool-size limitation above — the generator does not always produce "database instance" or "DBA" questions among the top-5 MCQs from this source. If source text is expanded, these tests may start asserting rather than skipping.

3. **Hard relevance filter limited for same-domain sources:** Every DBMS candidate shares the word "database" with every DBMS question stem, so the hard filter's practical effect is limited to cross-domain contamination (OS terms appearing in a DBMS quiz). The reservation mechanism carries the meaningful load for intra-domain reuse.

4. **No browser test was performed** — manual browser verification is still needed as stated in section 5.
