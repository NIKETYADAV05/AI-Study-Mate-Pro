# Distractor Quality Plan — MCQ Repetition Remains After Previous Fix

## What the previous fix achieved

The first fix (documented in `quiz-fix-plan.md`, reviewed in `quiz-fix-review.md`)
correctly moved `_build_distractor_pool` from being called once with
`correct_answer=""` in `_assemble_quiz` to being called per-question inside
`_build_mcq` with the real correct answer. The shared-pool bug is gone.

The existing tests all pass, and `correct_index` integrity after shuffle is solid.

---

## Root Cause — Why Questions Still Look Repetitive

Diagnosed by running the DBMS source through the live code and inspecting actual
pool contents and MCQ output.

### Bug 1 — `_build_distractor_pool` picks from the global answer set in source order

The pool is built by iterating `all_sentences` in their **original document
order** and extracting the predicate from each sentence with
`_extract_answer_from_sentence`. The result is a flat list of all other
questions' **correct answers**, ordered by their position in the source.

Because the pool has no per-question ranking, every question draws the same
leading candidates: `['organised collection…', 'organised and optimised',
'typically structured across multiple tables', …]`. These are the first answers
extracted from the document, regardless of whether they are topically relevant
to the question being asked.

Observed in live DBMS output:
- Q1 distractors: `'usually controlled by DBMS'`, `'organised and optimised'`, `'typically structured…'`
- Q4 distractors (database instance, correct: `'state of the database…'`): **same three candidates**
- Q5 distractors (Normalisation, correct: `'process of organising…'`): **same three candidates**

The three leading pool items rotate as correct answers cycle through, but the
result is that the user sees the same four phrases across nearly every question.

### Bug 2 — `'organised and optimised'` is a bad answer that then poisons every distractor pool

The sentence `"…manage how the information is organised and optimised."` has its
predicate captured as `'organised and optimised'` via Pattern 1 (the `managed …`
verb-object regex), which matches `manage … organised and optimised` and takes
only the terminal fragment. This two-word phrase:

- Contains no meaningful nouns — it is too weak to be a quiz answer
- Appears in every single distractor pool (it passes the similarity gate because
  its content-word set `{'organised', 'optimised'}` overlaps with nothing)
- Makes every question look like it has a generic, low-quality option

### Bug 3 — No keyword-relevance ranking in pool selection

`_build_distractor_pool` has no concept of which candidates are topically
related to the current question. Distractors are selected purely by
**first-come / document-order** — the first three candidates that survive
the `correct_lower.startswith` and similarity checks are chosen, regardless
of whether they share any topic with the question.

The ideal behaviour: prefer distractors whose content words overlap with the
**question stem** (the `question_text` returned by `_extract_answer_from_sentence`),
because a topically relevant wrong answer is a plausible distractor, while an
unrelated one is noise.

### Bug 4 — Minimum answer-quality threshold is too permissive

`_build_mcq` only rejects answers shorter than 4 characters. Answers like
`'organised and optimised'` (3 words, 2 meaningful but weak) are accepted and
then injected into every other question's distractor pool. The minimum should
require at least **3 meaningful (non-stop-word) words** to filter out
adjectival fragments, past-participial pairs, and truncated clauses.

### Frontend safety re: fewer than 4 options

`Quiz.js` renders `q.options.map((opt, i) => …)` — it does not hard-code 4
slots. `handleSelectAnswer` and `finishQuiz` both use the array length. The
`OPTION_LABELS = ["A","B","C","D"]` constant is used as `OPTION_LABELS[i]`, so
if there were only 3 options it would use A/B/C correctly (no out-of-bounds
crash). However, the existing `_build_mcq` already enforces `len(options) < 4
→ return None`, so we must not change that behaviour — the existing tests and
the task requirements both mandate 4 options or skip. **Frontend does not need
changes.**

---

## Implementation Plan

All changes are confined to `backend/api/views.py` and `backend/api/tests.py`.
No model, migration, URL, or frontend changes are needed.

---

- [ ] 1. Add a `_meaningful_word_count` helper and a stronger minimum-quality
         gate on extracted answers.

      **What to do:** Add a small helper function `_meaningful_word_count(text)`
      that returns the count of words in `text` that are not in `STOP_WORDS` and
      are at least 3 characters long. Then, inside `_build_mcq`, after the block
      that sets `answer = _cap_phrase(answer)`, add a guard:

      ```python
      # Reject answers with fewer than 3 meaningful words — they produce
      # low-quality distractors and weak question stems.
      if _meaningful_word_count(answer) < 3:
          return None
      ```

      Apply the same guard inside `_build_distractor_pool` when evaluating
      each `candidate`: skip any candidate whose `_meaningful_word_count` < 3.
      This eliminates `'organised and optimised'`, `'fields, and relationships
      between them'`, and similar weak fragments from both answers and
      distractor pools.

      **Files:** `backend/api/views.py`
      - Add `_meaningful_word_count` near the top of the quiz section
        (after the `STOP_WORDS` definition, before `_build_distractor_pool`).
      - Modify `_build_mcq` (the answer-quality check block, around line 1390).
      - Modify `_build_distractor_pool` (the `if len(candidate) < 6` guard block).

      **Verify:** `python manage.py test api` — all existing tests still pass.
      `'organised and optimised'` must no longer appear in any option across
      any question when the DBMS source is used (confirmed by the new regression
      tests added in item 5).

---

- [ ] 2. Add per-question keyword ranking to `_build_distractor_pool`.

      **What to do:** Change `_build_distractor_pool`'s signature to accept the
      question stem text as an additional parameter:

      ```python
      def _build_distractor_pool(
          all_sentences: list[str],
          freq: Counter,
          correct_answer: str,
          difficulty: str,
          question_text: str = "",          # NEW — question stem for relevance ranking
      ) -> list[str]:
      ```

      Inside the function, after the pool is assembled (after the supplement
      block that runs when `len(pool) < 6`), rank the pool by keyword overlap
      with `question_text` before returning it. Specifically:

      1. Extract content words from `question_text`:
         ```python
         q_words = set(re.findall(r'\b[a-z]{3,}\b', question_text.lower())) - STOP_WORDS
         ```

      2. Score each pool candidate by Jaccard overlap of its content words
         against `q_words`:
         ```python
         def _relevance(candidate: str) -> float:
             c_words = set(re.findall(r'\b[a-z]{3,}\b', candidate.lower())) - STOP_WORDS
             if not q_words or not c_words:
                 return 0.0
             return len(q_words & c_words) / max(1, len(q_words | c_words))
         ```

      3. Sort pool **descending** by `_relevance`, breaking ties by keeping
         document order (i.e., use a stable sort):
         ```python
         pool.sort(key=_relevance, reverse=True)
         ```

      4. In `_build_mcq`, pass `question_text` when calling
         `_build_distractor_pool`:
         ```python
         distractor_pool = _build_distractor_pool(
             all_sentences, freq,
             correct_answer=answer,
             difficulty=difficulty,
             question_text=question_text,    # NEW
         )
         ```

      **Why this helps:** For Q4 `"A database instance is the ___?"`, the
      question stem contains `'database'`, `'instance'`. Candidates like
      `'state of the database…'` share `'database'` (high relevance),
      `'usually controlled by a database management system (DBMS)'` also shares
      `'database'` — these are topically related wrong answers. The weak
      `'organised and optimised'` (already filtered in item 1) and fully
      unrelated candidates will rank last and only appear when nothing better
      is available.

      **Files:** `backend/api/views.py`
      - `_build_distractor_pool` signature and body (add ranking step at the end).
      - `_build_mcq` call site (pass `question_text=question_text`).

      **Verify:** `python manage.py test api` — all tests pass. For DBMS
      material, the cross-question distractor overlap test (added in item 5)
      must pass: no two questions may share all three distractors.

---

- [ ] 3. Strengthen the substring/prefix filter in `_build_distractor_pool`.

      **What to do:** The existing check rejects a candidate if
      `correct_lower.startswith(cand_lower[:20]) or cand_lower.startswith(correct_lower[:20])`.
      This is fragile for cases where the correct answer and a distractor share a
      long common prefix but diverge after 20 characters.

      Replace the 20-character prefix check with a proper **similarity ratio**
      filter using `difflib.SequenceMatcher` (stdlib, no new dependency). Reject
      any candidate whose similarity ratio to the correct answer exceeds **0.85**:

      ```python
      from difflib import SequenceMatcher

      def _similarity_ratio(a: str, b: str) -> float:
          return SequenceMatcher(None, a.lower(), b.lower()).ratio()
      ```

      Inside `_build_distractor_pool`, replace the two `startswith` lines with:

      ```python
      if _similarity_ratio(candidate, correct_answer) > 0.85:
          continue
      ```

      Also apply this check when selecting the final 3 distractors inside
      `_build_mcq` (the loop over `distractor_pool`):

      ```python
      if _similarity_ratio(d_capped, answer) > 0.85:
          continue
      ```

      This correctly rejects a distractor like `'process of organising a
      database to reduce data redundancy'` when the correct answer is
      `'process of organising a database to reduce data redundancy and improve
      data integrity'` (they share > 85% of characters).

      **Files:** `backend/api/views.py`
      - Add `from difflib import SequenceMatcher` at the top of the quiz section.
      - Add `_similarity_ratio` helper before `_build_distractor_pool`.
      - Replace the `startswith` check in `_build_distractor_pool`.
      - Add the similarity check in `_build_mcq`'s distractor selection loop.

      **Verify:** `python manage.py test api` — all tests pass.

---

- [ ] 4. Add trailing-preposition / trailing-conjunction cleanup to extracted
         answers and distractor candidates.

      **What to do:** `_extract_answer_from_sentence` can return answers ending
      with a dangling preposition, conjunction, or article, such as
      `'…to reduce data redundancy and improve data'` (truncated at cap).
      `_cap_phrase` already strips trailing `and/or/but/nor/by/with/as/of/to/
      for/in/on/at` conjunctions and prepositions with a regex — but only when
      the string exceeds `max_chars`. Apply the same cleanup unconditionally
      to every extracted answer and every distractor candidate.

      Add a small `_clean_trailing_stops(text)` helper that applies the
      same trailing-conjunction strip unconditionally:

      ```python
      # Trailing stop words to strip from answer/distractor endings
      _TRAILING_STOP_PAT = re.compile(
          r'\s+\b(and|or|but|nor|by|with|as|of|to|for|in|on|at|a|an|the)\s*$',
          re.IGNORECASE,
      )

      def _clean_trailing_stops(text: str) -> str:
          """Strip trailing prepositions/conjunctions/articles from a phrase."""
          result = _TRAILING_STOP_PAT.sub('', text).rstrip(',;: ')
          # Repeat in case multiple trailing stops were stacked
          while True:
              cleaned = _TRAILING_STOP_PAT.sub('', result).rstrip(',;: ')
              if cleaned == result:
                  break
              result = cleaned
          return result
      ```

      Call `_clean_trailing_stops` in two places:
      1. In `_extract_answer_from_sentence`, apply it to `answer_raw` before
         the length check (`if len(answer_raw) >= 4`).
      2. In `_build_distractor_pool`, apply it to `candidate` after the cap step.

      **Files:** `backend/api/views.py`
      - Add `_TRAILING_STOP_PAT` and `_clean_trailing_stops` before
        `_extract_answer_from_sentence`.
      - Apply in `_extract_answer_from_sentence` (both Pattern 1 and Pattern 2).
      - Apply in `_build_distractor_pool` (main loop and supplement loop).

      **Verify:** `python manage.py test api` — all tests pass.
      `'process of organising a database to reduce data redundancy and improve
      data'` must become `'process of organising a database to reduce data
      redundancy and improve data integrity'` — i.e., the truncation that strips
      `'and improve data'` (if it occurs) must leave a clean phrase.
      Note: the cap at 80 chars is separate from this cleanup; this only removes
      trailing function words that appear at the natural end of the captured string.

---

- [ ] 5. Add DBMS-specific regression tests to `tests.py`.

      **What to do:** Append a new test class `DistractorQualityDBMSTest` to
      `backend/api/tests.py`. **Do NOT replace the existing file** — append only.
      The class must use the DBMS source text defined below as a module-level
      constant `_DBMS_SOURCE`.

      ```python
      _DBMS_SOURCE = """
      A database is an organised collection of structured information or data,
      typically stored electronically in a computer system.
      A database is usually controlled by a database management system (DBMS).
      The DBMS serves as an interface between the database and its end users or
      programs, allowing users to retrieve, update, and manage how the
      information is organised and optimised.
      A relational database organises data into rows and columns, which
      collectively form a table.
      Data is typically structured across multiple tables, which can be joined
      together via a primary key or a foreign key.
      A database schema defines the structure of the database, including the
      tables, fields, and relationships between them.
      A database instance is the state of the database at a particular moment
      in time.
      The relational model was introduced by E.F. Codd in 1970 and organises
      data into relations or tables.
      SQL stands for Structured Query Language and is used to manage and query
      relational databases.
      A data model is an abstract representation of the data structures and
      relationships.
      Normalisation is the process of organising a database to reduce data
      redundancy and improve data integrity.
      A transaction is a unit of work that is performed against a database.
      Indexes are used to speed up the retrieval of data from a database table.
      """
      ```

      **Test methods to include:**

      **test_no_generic_two_word_distractors** — Generate 5 MCQs. Assert that no
      option in any question is a phrase with fewer than 3 meaningful
      (non-stop-word) words. This directly catches `'organised and optimised'`
      and similar weak fragments.

      **test_distractors_not_all_same_across_questions** — Generate 5 MCQs.
      Collect the full frozenset of options for each question. Assert that not all
      questions share the exact same 3 non-correct-answer options. (Identical to
      `QuizOptionDiversityTest.test_options_not_identical_across_all_questions`
      but using DBMS source material specifically.)

      **test_correct_answer_not_in_distractors** — Generate 5 MCQs. For each
      question, assert that the correct answer (normalised) does not appear in the
      distractor options.

      **test_no_trailing_preposition_in_any_option** — Generate 5 MCQs. For each
      option string, assert it does not end with a bare preposition, conjunction,
      or article (`and`, `or`, `of`, `to`, `for`, `in`, `on`, `at`, `a`, `an`,
      `the` — case-insensitive, whole-word match at string end).

      **test_similarity_ratio_above_threshold_rejected** — Call
      `_build_distractor_pool` directly with a correct answer and a source list
      that contains a near-identical candidate (similarity > 0.85). Assert the
      near-identical candidate is not in the returned pool.

      **Files:** `backend/api/tests.py` — append `_DBMS_SOURCE` constant and
      `DistractorQualityDBMSTest` class.

      **Verify:** `python manage.py test api` — all new tests pass alongside all
      existing tests.

---

## Verification Steps (run in order from `backend/` with venv active)

```
python manage.py check
python manage.py makemigrations --check
python manage.py test api
cd ../frontend && npm run build
```

Expected outcomes:
- `check` → `System check identified no issues (0 silenced).`
- `makemigrations --check` → `No changes detected`
- `test api` → all tests pass (existing 4 classes + new `DistractorQualityDBMSTest`)
- `npm run build` → exits 0 (no frontend changes)

---

## Files Changed

| File | Change |
|------|--------|
| `backend/api/views.py` | Add `_meaningful_word_count`, `_similarity_ratio`, `_clean_trailing_stops`, `_TRAILING_STOP_PAT`; strengthen answer-quality gate in `_build_mcq`; add ranking + quality filters in `_build_distractor_pool`; strengthen similarity filter; add `from difflib import SequenceMatcher` |
| `backend/api/tests.py` | Append `_DBMS_SOURCE` constant and `DistractorQualityDBMSTest` class |

---

## Libraries

No new dependencies. All changes use Python stdlib only:
- `difflib.SequenceMatcher` (already in stdlib, already available in Django's Python)
- `re` (already imported at module top)
- `collections.Counter` (already imported)

`requirements.txt` is unchanged.

---

## What Does NOT Change

- `Quiz.js` — no edits. The frontend safely renders variable-length `q.options`
  arrays. The 4-option minimum is enforced by `_build_mcq` returning `None`.
- All Django models, migrations, URLs, settings — no edits.
- All other views (`summarize`, notes, tasks, revision plan, quiz attempts) — no edits.
- The API response structure (`questions`, `warnings`, `total`, `difficulty`,
  `quiz_type`) — unchanged.
- Existing tests (`QuizOptionDiversityTest`, `QuizAnswerEvalTest`,
  `QuizShortSourceTest`, `QuizExistingRegressionTest`) — preserved, must still pass.

---

## Remaining Limitations (after this fix)

- **Homogeneous single-concept documents:** A source where every sentence
  describes the same narrow concept (e.g. "What is a primary key?") will still
  produce repetitive distractors because all answers are from the same semantic
  field. This is a fundamental limit of purely extractive distractor generation
  without an external knowledge base.
- **Very short sources** (< 6 quiz-worthy sentences): the pool will have fewer
  than 3 candidates after quality filtering, and `_build_mcq` will return `None`
  for all questions, triggering the "not enough sentences" warning. This is the
  correct and safe behaviour; the short-source test verifies it.
- **No browser testing performed** — this is a backend-only change.
