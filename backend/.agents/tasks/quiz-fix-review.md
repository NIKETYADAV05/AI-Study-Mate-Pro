# Per-question distractor pools for the MCQ quiz generator

The repeated-options bug was traced to a single shared `_build_distractor_pool` call in `_assemble_quiz` that was invoked once with `correct_answer=""` and then reused for every MCQ. Because the pool was built without a real correct answer, the similarity gate was effectively disabled, and every question drew from the same fixed-order candidate list — causing near-identical option sets across all questions. The fix moves pool construction inside `_build_mcq`, calling `_build_distractor_pool` with the actual correct answer for each question. A deduplication pass inside `_build_mcq` ensures no option appears twice within a single question. No model, migration, or frontend file was changed.

Watch for: (1) **confirmed** — `_assemble_quiz` no longer contains the shared `dist_pool` call; the MCQ loop passes `all_sentences` and `freq` directly to `_build_mcq`. (2) **confirmed** — `correct_index` is derived with `options.index(answer)` after `random.shuffle`, so shuffle cannot break evaluation. (3) **confirmed** — `_build_mcq` returns `None` rather than emitting a sub-4-option question when deduplication shrinks the option list below 4.

**Verdict**: APPROVED

---

## High-level view

The root cause was fully removed: the shared pool and the `correct_answer=""` call in `_assemble_quiz` are gone, replaced by a per-question call inside `_build_mcq` with the real extracted answer. This is the minimal targeted change that fixes the diversity failure without touching the surrounding algorithm.

The dedup pass inside `_build_mcq` normalises options case-insensitively before shuffling, and the `correct_index` is set with `options.index(answer)` on the post-shuffle list, so shuffle cannot produce a stale index.

The new tests cover intra-question duplicate detection, cross-question option diversity, `correct_index` validity after shuffle (five independent runs), short-source graceful fallback, and a full API smoke test for response shape and correctness. The `_SHORT_SOURCE` committed to `tests.py` is three sentences rather than the single-sentence string in the plan, which makes the "not enough sentences" warning path easier to exercise.

---

<details>
<summary>Issues (0)</summary>

No blocking or non-blocking issues found.

</details>

---

<details>
<summary>Details</summary>

### Shared pool removal and per-question distractor construction

In the old code, `_assemble_quiz` called `_build_distractor_pool(all_sentences, freq, correct_answer="", difficulty=difficulty)` before the MCQ loop and passed the resulting list into every `_build_mcq` call. With `correct_answer=""`, `correct_lower` was `""` and `correct_words` was the empty set, so the similarity gate (`overlap = 0 / 1 = 0`) passed every candidate regardless of how closely it matched the real correct answer. The pool order was deterministic, so every question received the same leading three candidates as distractors.

The fix is surgical: `_build_mcq` now accepts `all_sentences` and `freq` in place of the pre-built pool, and calls `_build_distractor_pool` itself after `answer` is extracted:

```python
distractor_pool = _build_distractor_pool(
    all_sentences, freq,
    correct_answer=answer,   # real answer — similarity gate now meaningful
    difficulty=difficulty,
)
```

`_assemble_quiz` simply passes the raw NLP inputs through:

```python
q = _build_mcq(sentence, all_sentences, freq, difficulty, used_questions)
```

No trace of `dist_pool` remains in `_assemble_quiz`. (confirmed)

### Deduplication and correct_index correctness

After picking three distractors, `_build_mcq` deduplicates `[answer] + distractors` case-insensitively before shuffling. The guard `if answer not in options: return None` and `if len(options) < 4: return None` ensure the function bails rather than emitting a malformed question. `correct_index` is then set as `options.index(answer)` on the post-shuffle list. Because `index()` finds the first occurrence and the dedup pass guarantees the answer appears exactly once, this is unambiguous. (confirmed)

### Test coverage

`QuizOptionDiversityTest` checks no intra-question duplicates, correct-answer uniqueness, cross-question option diversity, and `correct_index` validity. `QuizAnswerEvalTest` re-runs assembly five times to catch shuffle-related flakiness. `QuizShortSourceTest` verifies the graceful-fallback path (empty question list with a warning, not an exception) using a three-sentence source. `QuizExistingRegressionTest` exercises the full HTTP endpoint for response shape, `correct_index` in-range, and short-input rejection.


</details>

---

<details>
<summary>File map</summary>

| File | What changed |
|------|--------------|
| `backend/api/views.py` | `_build_mcq` signature changed to accept `all_sentences`/`freq`; per-question `_build_distractor_pool` call added; intra-question dedup pass added; shared `dist_pool` removed from `_assemble_quiz` |
| `backend/api/tests.py` | Four new test classes appended: `QuizOptionDiversityTest`, `QuizAnswerEvalTest`, `QuizShortSourceTest`, `QuizExistingRegressionTest` |

Full diff: `git diff main -- backend/api/views.py backend/api/tests.py`

</details>
