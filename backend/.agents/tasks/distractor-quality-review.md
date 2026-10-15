# MCQ distractor-quality fix for AI StudyMate Pro

The change replaces a shared generic distractor pool with a per-question pool built against each question's own correct answer and question stem. `_build_distractor_pool` now accepts a `question_text` parameter and ranks candidates by keyword overlap with the question. Three quality helpers — `_meaningful_word_count`, `_similarity_ratio`, and `_clean_trailing_stops` — gate every candidate before it enters the pool, and the same gates are applied again in `_build_mcq` when selecting the final three distractors. The correct-answer gate (`options.index(answer)` post-shuffle) was present before this change and remains intact.

Watch for: (1) **confirmed** — the similarity gate uses `[:60]` truncation in `seen_lower` but the full string in `_similarity_ratio`, creating an inconsistency that can admit near-duplicate long candidates; (2) **confirmed** — the supplement loop in `_build_distractor_pool` omits the `easy`/`hard` difficulty overlap filter, so difficulty semantics are silently dropped for thin pools.

**Verdict**: NEEDS_CHANGES

## High-level view

The core distractor-pool function is structurally sound: it iterates prose sentences, extracts a candidate phrase per sentence via `_extract_answer_from_sentence`, applies quality gates (3-word minimum, trailing-stop strip, 0.85 similarity ceiling against the correct answer), and ranks survivors by keyword overlap with the question stem. This delivers per-question distractor variety rather than a shared pool.

The `seen_lower` deduplication key truncates to 60 characters before the similarity ratio check operates on the full string. For candidates longer than 60 characters this means two near-identical long phrases can both enter the pool because their 60-char prefixes differ, and the similarity gate never fires on the truncated key.

The supplement loop adds candidates when the pool is thin (< 6), but it omits the difficulty-based overlap filter (`easy`/`hard` branches) that the main loop applies. A thin pool on `easy` difficulty can therefore receive high-overlap distractors that the main loop would have rejected.

The regression test suite covers all six required behavioral cases and is appended after the existing test classes without modifying them. No migrations were touched; all five migration files predate this change.

<details>
<summary>Issues (4)</summary>

1. **`seen_lower` truncation bypasses similarity gate for long candidates** — `seen_lower.add(cand_lower)` stores only `candidate.lower()[:60]`, but `_similarity_ratio` compares full strings. Two candidates whose first 60 characters differ but whose full text is > 0.85 similar will both pass the dedup check and the similarity check, since the seen-set key never matches. Fix: either store the full lowercase string in `seen_lower`, or apply `_similarity_ratio` against all previously accepted pool members (not just the correct answer) before adding.

2. **Supplement loop drops difficulty overlap filter** — the main loop applies `if difficulty == "easy" and overlap > 0.4: continue` and `if difficulty == "hard" and overlap < 0.05: continue`. The supplement loop (lines under `if len(pool) < 6`) does not. A thin pool at `easy` difficulty will admit high-overlap distractors that undermine the stated easy-mode design. Fix: extract the overlap-filter block into a helper and call it from both loops.

3. **`_build_mcq` inner similarity gate not independently tested** — `test_similarity_ratio_above_threshold_rejected` verifies the pool-level gate but not the identical gate inside `_build_mcq`'s distractor selection loop. If that inner gate were removed, no test would catch it. Add a test that calls `_build_mcq` directly with a source containing a near-duplicate of the correct answer and checks it is absent from `options`.

4. **`hard` difficulty path untested** — all new `DistractorQualityDBMSTest` calls use `"medium"`. The `overlap < 0.05` filter in the main loop is never exercised; a refactor removing it would go undetected. Add one `_generate_mcq(difficulty="hard")` call with an assertion that at least one option exists.

</details>

<details>
<summary>Details</summary>

### `seen_lower` truncation creates a gap in the dedup/similarity chain (confirmed)

Inside `_build_distractor_pool`, every accepted candidate is registered as:

```python
seen_lower.add(cand_lower)   # cand_lower = candidate.lower()[:60]
```

The check that prevents admitting near-duplicates of the *correct answer* is:

```python
if _similarity_ratio(candidate, correct_answer) > 0.85:
    continue
```

This compares full strings — correct. But the check that prevents admitting near-duplicates of *other pool members* is the `cand_lower in seen_lower` membership test against 60-char keys. Two candidates of length > 60 that share a first 60 characters will be caught; two that differ in their first 60 characters but are > 0.85 similar in full will both pass. Because the pool can contain up to ~12 entries and the source material for a DBMS quiz has several semantically close sentences (e.g., "an organised collection of structured information" vs. "an organised collection of structured data"), this is realistically triggerable, not theoretical.

The fix is one line: change `candidate.lower()[:60]` to `candidate.lower()` in the `seen_lower.add` call, and update the lookup to match.

### Supplement loop silently drops difficulty semantics (confirmed)

The main candidate loop inside `_build_distractor_pool` contains:

```python
if difficulty == "easy" and overlap > 0.4:
    continue
if difficulty == "hard" and overlap < 0.05:
    continue
```

The supplement loop that fires when `len(pool) < 6` contains neither branch. It does include a cross-pool similarity check (`too_similar` against existing pool members), but that uses a 0.55 threshold against set-intersection, not the per-difficulty overlap logic. The practical consequence: on a short DBMS source (the `test_short_source_dbms_does_not_crash` test case), the pool will typically be thin, the supplement loop will fire, and the difficulty parameter is ignored for all candidates it adds.

### Test coverage gap: `_build_mcq` inner similarity gate untested (confirmed)

The `test_similarity_ratio_above_threshold_rejected` test verifies near-duplicates are excluded from the pool returned by `_build_distractor_pool`. A separate, identical similarity gate inside `_build_mcq`'s distractor selection loop is never exercised independently. If that gate were accidentally removed, no test would catch it. Add a test that calls `_build_mcq` directly with a source containing a near-duplicate of the correct answer and asserts it is absent from `options`.

### `hard` difficulty path not covered by new tests (likely)

`DistractorQualityDBMSTest` runs every `_generate_mcq` call at `"medium"`. The `hard` path (`overlap < 0.05` in the main loop) is never exercised.

</details>

---

<details>
<summary>File map</summary>

| File | What changed |
|---|---|
| `backend/api/views.py` | Added `_meaningful_word_count`, `_similarity_ratio`, `_clean_trailing_stops` helpers; rewrote `_build_distractor_pool` with per-question quality gates, difficulty-aware overlap filter, and relevance ranking; added `question_text` parameter; tightened `_build_mcq` distractor selection loop |
| `backend/api/tests.py` | Appended `DistractorQualityDBMSTest` class with 6 new test methods; existing 4 test classes preserved without modification |
| `frontend/app/components/Quiz.js` | No changes |

Full diff: `git diff main -- backend/api/views.py backend/api/tests.py`

</details>
