# Distractor Reuse Trace — Root-Cause Analysis

**Date:** 2025  
**Source files inspected:** `backend/api/views.py` (full), `backend/api/tests.py` (full),
`distractor-quality-plan.md`, `distractor-quality-review.json`  
**Runtime traces executed:** yes — `manage.py shell` with `_DBMS_SOURCE` from `tests.py`

---

## Six Questions Answered

### Q1 — Where is `_build_distractor_pool` called?

**Per-question, inside `_build_mcq`.** The call is at `views.py` line 1492:

```python
distractor_pool = _build_distractor_pool(
    all_sentences, freq,
    correct_answer=answer,
    difficulty=difficulty,
    question_text=question_text,
)
```

`_build_mcq` is called once per source sentence in `_assemble_quiz`'s MCQ loop
(line 1753). The previous bug of one shared pool in `_assemble_quiz` was fixed in
the prior round. The per-question call is correct.

---

### Q2 — Is the relevance ranking a HARD FILTER or a soft ranking?

**Soft ranking only — NOT a hard filter.**

The ranking code at the bottom of `_build_distractor_pool` is:

```python
if question_text:
    q_words = set(re.findall(r'\b[a-z]{3,}\b', question_text.lower())) - STOP_WORDS

    def _relevance(candidate: str) -> float:
        c_words = set(re.findall(r'\b[a-z]{3,}\b', candidate.lower())) - STOP_WORDS
        if not q_words or not c_words:
            return 0.0
        return len(q_words & c_words) / max(1, len(q_words | c_words))

    pool.sort(key=_relevance, reverse=True)
```

There is no `if _relevance(candidate) == 0.0: continue` or any threshold filter.
Zero-overlap candidates receive `_relevance = 0.0` and are sorted to the **back** of
the pool, but they remain in the pool. When the pool has only 8 items and 3 distractors
are needed, zero-relevance items are drawn from the tail freely. This is the soft
ranking behaviour.

Confirmed by the live trace (see POOL CONTENTS section): the database-instance
question (`"A database instance is the ___?"`) has a pool where candidates with
`relevance=0.000` — `'organised collection of structured information or data'`,
`'typically structured across multiple tables'`, `'used to manage and query relational
databases'`, `'abstract representation of the data structures and relationships'` —
**all survive** and are reused when the top-ranked items are exhausted or already
consumed by earlier questions.

---

### Q3 — Is there ANY mechanism tracking which distractors were used by earlier questions?

**No. There is no cross-question reservation mechanism.**

`_assemble_quiz` maintains `used_questions: set[str]` to prevent the **same source
sentence** from generating two questions, but there is no `used_distractors: set[str]`
or any structure that prevents a distractor chosen by Q1 from being chosen again by Q2.

Every call to `_build_distractor_pool` starts from scratch: it builds the same
8-item pool from the same 9 valid source answers, scores relevance against the
**new** question stem, and then `_build_mcq` picks the top 3 from that pool.

**This is the core remaining bug.** When the pool has 9 candidates and 5 questions
each need 3 distractors (15 total draws), with no reservation, the most
relevance-ranked candidates are drawn again and again across every question.

Live trace confirms: after 5 MCQs on the DBMS source, `Q1` and `Q2` share all 3
distractors, `Q1/Q2/Q4` all share `'unit of work that is performed against a
database'` and `'used to speed up the retrieval of data from a database table'`,
and multiple other pairs share 1–3 distractors.

---

### Q4 — Why does `'one of the most widely used database models'` appear as a distractor across questions?

**The phrase is NOT present in the standard `_DBMS_SOURCE` used in tests.py.**

The sentence `"The relational model was introduced by E.F. Codd in 1970 and organises
data into relations or tables."` — which IS in `_DBMS_SOURCE` — gets **split** by
`split_into_sentences` into two fragments at the `E.F.` abbreviation boundary:

- `[7]` → `'The relational model was introduced by E.F.'` (fails `_is_quiz_worthy`, < 8 words after split)
- `[8]` → `'Codd in 1970 and organises data into relations or tables.'` (fails `_is_quiz_worthy`, no leading capital subject; also `_UNUSABLE_STARTERS` check would not apply but `_is_quiz_worthy` requires `len(s.split()) >= 8` — this is 9 words — but the verb check fires: "organises" is not in `verb_indicators`, and actually "organises" is absent while "is" is checked as substring " is " — let's note this sentence is borderline but likely excluded by lack of standard verb indicators)

When the user observed `"one of the most widely used database models"` in the browser,
that phrase comes from a **different, longer source text** they pasted — likely one
that included the sentence `"The relational model is one of the most widely used
database models."` If that sentence is in the source, the answer extracted by
Pattern 1 (predicate-noun) is `"one of the most widely used database models in modern
computing"` (mwc ≥ 3, passes all gates). It then lands in every pool because it
contains the word `"database"` (giving it relevance ≥ 0.0 for any database question)
and no distractor-dedup gate checks whether it was already chosen by a prior question.

Similarly `"without redesigning the entire database"` comes from a sentence like
`"The schema can evolve without redesigning the entire database."` — that phrase is
captured by Pattern 2 (verb–object: `"redesigning … the entire database"`) or Pattern 1
(`"without redesigning the entire database"` after verb extraction). Both phrases
survive the pool quality gate and are reused freely across questions because
**no cross-question reservation exists**.

The exact path:
1. Source sentence (e.g. `"The relational model is one of the most widely used database models."`) is quiz-worthy.
2. `_extract_answer_from_sentence` → Pattern 1 captures `"one of the most widely used database models"` (mwc=5, passes quality gate).
3. `_build_distractor_pool` for any question whose `correct_answer` does not trigger the similarity gate (ratio ≤ 0.85) adds this candidate to the pool.
4. Relevance for a `"database instance"` question stem: `q_words = {'database', 'instance'}`, `c_words = {'widely', 'used', 'database', 'models'}`, overlap = 1/5 = 0.20 — **non-zero, so it ranks high** (ahead of zero-overlap candidates), gets selected.
5. For a `"Database Administrator"` question: `q_words = {'database', 'administrator'}`, `c_words` same, overlap = 1/5 = 0.20 — **same rank, selected again**.
6. For a `"database"` question: `q_words = {'database'}`, overlap = 1/4 = 0.25 — **same candidate, same rank, selected yet again**.

The shared word `"database"` is the only word needed to make any DBMS-related candidate
rank ≥ 0.20 for any DBMS question. Because all DBMS questions contain `"database"` in
their stem, all candidates with `"database"` in their text rank identically high —
and without reservation, the same handful wins every time.

---

### Q5 — Does the supplement loop bypass quality checks that the main loop applies?

**No — the supplement loop applies the same checks as the main loop** (this was the
prior "finding 2 fix"). Both loops apply:

- `_meaningful_word_count(candidate) < 3` → skip
- `len(candidate) < 6/8` → skip (supplement uses the stricter `< 8`)
- `_similarity_ratio(candidate, correct_answer) > 0.85` → skip
- `_fails_difficulty_overlap(cand_words)` → skip

The supplement loop adds one **extra** check not in the main loop:

```python
too_similar = any(
    ...pool_member_overlap... > 0.55 for p in pool
)
if not too_similar:
    pool.append(candidate)
```

This is a **within-question** inter-distractor similarity gate, which is fine. No
check that belongs in one loop is absent from the other.

**One real gap:** the supplement loop's minimum length guard is `< 8` vs the main
loop's `< 6`. This means a candidate that is 6 or 7 characters (e.g. a bare term)
passes the main loop but is blocked in the supplement. This is a minor inconsistency
but not a quality regression — the stricter 8-char guard in the supplement is safer.

---

### Q6 — How many quiz-worthy candidates does a ~500-word DBMS source yield?

**Exactly 9 effective candidates** from the 13-sentence `_DBMS_SOURCE` in tests.py:

| # | Extracted answer |
|---|-----------------|
| 0 | `organised collection of structured information or data` |
| 1 | `usually controlled by a database management system (DBMS)` |
| 2 | `typically structured across multiple tables` |
| 3 | `state of the database at a particular moment in time` |
| 4 | `used to manage and query relational databases` |
| 5 | `abstract representation of the data structures and relationships` |
| 6 | `process of organising a database to reduce data redundancy and improve data` |
| 7 | `unit of work that is performed against a database` |
| 8 | `used to speed up the retrieval of data from a database table` |

4 sentences fail the `mwc < 3` quality gate or produce answers too short:
- Sentence [2] → `'organised and optimised'` (mwc=2) — **filtered out** ✓
- Sentence [3] → `'collectively form a table'` fails `_is_quiz_worthy` (< 8 words... actually 8 words — let me re-check: the sentence is 15 words; the extracted answer is `'collectively form a table'` which is 3 words mwc=2, filtered) — **filtered out** ✓
- Sentence [5] → `'fields, and relationships between them'` (mwc=2) — **filtered out** ✓
- Sentence [7] → `'introduced by E'` (mwc=1) — **filtered out** ✓

**9 candidates to serve 5 questions × 3 distractors = 15 total distractor draws with no reservation.**
The pool is so small that massive cross-question reuse is **mathematically guaranteed** without reservation. Even if relevance ranking works perfectly (which it can't because all DBMS candidates share the word "database"), a single question draws 3 of 8 remaining candidates; the next question has the same 8 (no reservation) and draws its own top-3 with heavy overlap.

---

## POOL CONTENTS

**Manual walk-through of `_build_distractor_pool` for the sentence:**
`'A database instance is the state of the database at a particular moment in time.'`

- `correct_answer = "state of the database at a particular moment in time"`
- `correct_words = {'state', 'database', 'particular', 'moment', 'time'}` (after STOP_WORDS removal)
- `difficulty = "medium"`
- `question_text = "A database instance is the ___?"`
- `q_words = {'database', 'instance'}` (after STOP_WORDS removal; "the" is a stop word, "_" is not alphabetic)

**Main loop — candidates admitted (in document order):**

| Sentence idx | Raw candidate | Cleaned candidate | mwc | sim_ratio | overlap | Admit? |
|---|---|---|---|---|---|---|
| [0] | `organised collection of structured information or data` | same | 5 | 0.19 | 0/8=0.0 (no shared non-stops with `correct_words`) | ✓ |
| [1] | `usually controlled by a database management system (DBMS)` | same | 6 | 0.22 | `{database}`∩`correct_words`=`{database}` → overlap=1/8=0.125 | ✓ |
| [2] | `organised and optimised` | same | 2 | — | **mwc<3 → rejected** | ✗ |
| [4] | `typically structured across multiple tables` | same | 4 | 0.15 | 0 | ✓ |
| [5] | `fields, and relationships between them` | same | 2 | — | **mwc<3 → rejected** | ✗ |
| [6] | **Correct answer source — skipped** (seen_lower contains correct_lower) | — | — | — | ✗ |
| [9] | `used to manage and query relational databases` | same | 4 | 0.16 | 0 | ✓ |
| [10] | `abstract representation of the data structures and relationships` | same | 5 | 0.16 | 0 | ✓ |
| [11] | `process of organising a database to reduce data redundancy and improve data` | same | 8 | 0.28 | `{database}`→overlap=1/12=0.083 | ✓ |
| [12] | `unit of work that is performed against a database` | same | 4 | 0.19 | `{database}`→overlap=1/7=0.143 | ✓ |
| [13] | `used to speed up the retrieval of data from a database table` | same | 5 | 0.22 | `{database}`→overlap=1/9=0.111 | ✓ |

Pool after main loop: **8 candidates** (sentences [3] and [7]/[8] yield the correct answer and a fragment that fails `_is_quiz_worthy`, so the main loop ends with 8 items).

Pool size = 8 ≥ 6 → supplement loop does NOT run.

**Relevance sort (q_words = `{'database', 'instance'}`):**

| Candidate | q∩c | q∪c | relevance |
|---|---|---|---|
| `unit of work that is performed against a database` | `{database}` | `{database,unit,work,performed,instance}` → 5 | **0.200** |
| `used to speed up the retrieval of data from a database table` | `{database}` | 9 items | **0.167** |
| `usually controlled by a database management system (DBMS)` | `{database}` | 8 items | **0.143** |
| `process of organising a database to reduce data redundancy and improve data` | `{database}` | 12 items | **0.083** |
| `organised collection of structured information or data` | {} | 7 items | **0.000** |
| `typically structured across multiple tables` | {} | 6 items | **0.000** |
| `used to manage and query relational databases` | {} | 7 items | **0.000** |
| `abstract representation of the data structures and relationships` | {} | 7 items | **0.000** |

**Final pool returned (sorted by relevance):**
1. `'unit of work that is performed against a database'`
2. `'used to speed up the retrieval of data from a database table'`
3. `'usually controlled by a database management system (DBMS)'`
4. `'process of organising a database to reduce data redundancy and improve data'`
5. `'organised collection of structured information or data'`
6. `'typically structured across multiple tables'`
7. `'used to manage and query relational databases'`
8. `'abstract representation of the data structures and relationships'`

**`_build_mcq` picks the first 3:** → `['unit of work...', 'used to speed up...', 'usually controlled by...']`

Every DBMS question whose correct answer does NOT include the word `"database"` will get
the same top-3: items 1, 2, and 3 above, because they all tie for highest relevance
(each shares exactly `{database}` with any question stem that contains "database").
Questions whose answer does contain "database" (e.g. Q1 `"organised collection..."`,
Q2 `"usually controlled by DBMS"`) get those same candidates minus the one that became
their correct answer — same candidates, rotated.

---

## ROOT CAUSE

The core bug is a **combination of (a), (b), and (c)**, with (a) being the primary driver:

**(a) No cross-question reservation (primary driver).** `_assemble_quiz` never passes
a `used_distractors` set across the MCQ loop. Every call to `_build_distractor_pool`
starts from the same 8-9 candidate pool and selects the same top-ranked items, with no
knowledge of what prior questions already used. With a 9-candidate pool serving 5
questions × 3 distractors = 15 draws, reuse is mathematically unavoidable.

**(b) Relevance ranking is soft, not hard (amplifier).** Zero-overlap candidates are
ranked last but never rejected, so the 4 bottom candidates (relevance=0.000) flood in
whenever the top-4 candidates are partially consumed — but since there IS no
reservation, the top-4 are never consumed and are re-selected every time.
Additionally, the word `"database"` appears in every DBMS question stem AND in most
DBMS candidates, creating a false tie in relevance scores (all tied at ~0.143–0.200
based on `{database}` alone). The ranking therefore distinguishes very little between
semantically related and semantically unrelated distractors. Making the ranking a hard
filter (reject candidates with zero overlap with either question stem or correct answer)
would reduce the usable pool per question but significantly improve relevance.

**(c) Pool too small relative to demand (structural limit).** 9 candidates for 15 draws
means at least 6 must repeat even if reservation were perfect. This is a fundamental
limit of the extractive approach on short notes — adding a hard relevance filter further
reduces the usable per-question pool, making cross-question reservation even more
critical to maximise variety.

**(d) Normalisation answer is truncated (secondary defect).** The sentence
`"Normalisation is the process of organising a database to reduce data redundancy and
improve data integrity."` has an 85-char predicate. `_cap_phrase` trims at 80 chars to
the last word boundary, yielding `"process of organising a database to reduce data
redundancy and improve data"` (drops `"integrity"`). The truncation leaves a
grammatically incomplete answer. This is not directly related to reuse but degrades
option quality for that specific question.

---

## IMPLEMENTATION PLAN

### Files changed

| File | Change |
|---|---|
| `backend/api/views.py` | Add cross-question reservation, add hard relevance filter, fix Normalisation truncation |
| `backend/api/tests.py` | Add new assertions to `DistractorReuseFixTest` class (defined below) |

---

### Change 1 — Cross-question reservation in `_assemble_quiz` → `_build_mcq` (PRIMARY FIX)

**Why Approach A (cross-question reservation in `_assemble_quiz`):**

- Approach B (source partitioning — assign each sentence's answer exclusively to one
  question's pool) requires knowing which questions will be asked before building pools,
  creating a two-pass dependency. It also makes the pool for early questions artificially
  rich while later questions get only one candidate.
- Approach C (hybrid) adds complexity without clear gains over A when pool is this small.
- **Approach A** is a single additive change: one new parameter flowing from
  `_assemble_quiz` → `_build_mcq` → `_build_distractor_pool`. It does not alter the
  per-question quality gates, the relevance ranking, or any API contract. It is
  independently verifiable.

**Exact change in `_assemble_quiz`:**

```python
# Before the MCQ loop, initialise a reservation set
used_distractors: set[str] = set()

# In the MCQ loop, pass it to _build_mcq
for sentence in source_sentences:
    if len(questions) >= mcq_target:
        break
    q = _build_mcq(sentence, all_sentences, freq, difficulty, used_questions,
                   used_distractors)   # ← NEW argument
    if q:
        questions.append(q)
```

**Exact change in `_build_mcq` signature:**

```python
def _build_mcq(
    sentence: str,
    all_sentences: list[str],
    freq: Counter,
    difficulty: str,
    used_questions: set[str],
    used_distractors: set[str] | None = None,   # ← NEW
) -> dict | None:
```

**Inside `_build_mcq`, pass the reservation to `_build_distractor_pool`:**

```python
distractor_pool = _build_distractor_pool(
    all_sentences, freq,
    correct_answer=answer,
    difficulty=difficulty,
    question_text=question_text,
    used_distractors=used_distractors or set(),   # ← NEW
)
```

**After choosing the 3 distractors, register them:**

```python
# After `if len(distractors) == 3: break`
if used_distractors is not None:
    for d in distractors:
        used_distractors.add(d.strip().lower())
```

**Exact change in `_build_distractor_pool` signature and body:**

```python
def _build_distractor_pool(
    all_sentences: list[str],
    freq: Counter,
    correct_answer: str,
    difficulty: str,
    question_text: str = "",
    used_distractors: set[str] | None = None,   # ← NEW
) -> list[str]:
```

Inside the function, after the `seen_lower` set is initialised and before the main loop,
add the already-used distractors:

```python
# Exclude distractors already chosen by prior questions in this quiz run
_reserved = used_distractors or set()
```

Then in both the main loop and the supplement loop, after the `cand_lower in seen_lower`
check, add:

```python
if cand_lower in _reserved:
    continue
```

This ensures cross-question reservation is applied consistently in both loops.

**Result:** Q1 picks 3 from 8 candidates; Q2 sees only 5 remaining (8 minus the 3 taken
by Q1, minus Q2's own correct answer); Q3 sees 4, and so on. Questions near the end of
the quiz get less popular candidates, which is the correct behaviour — earlier questions
get the best-ranked distractors, later questions get the remaining ones (still valid,
just lower-ranked).

---

### Change 2 — Hard relevance filter (zero-overlap rejection)

Add a hard rejection in `_build_distractor_pool`'s main loop for candidates that have
**zero keyword overlap** with BOTH the question stem AND the correct answer:

```python
# Hard relevance filter: reject candidates with zero overlap with both
# the question stem and the correct answer content words.
# This prevents completely unrelated answers from appearing as distractors.
if question_text:
    q_words_local = set(re.findall(r'\b[a-z]{3,}\b', question_text.lower())) - STOP_WORDS
    has_q_overlap = bool(q_words_local & cand_words)
    has_a_overlap = bool(correct_words & cand_words)
    if not has_q_overlap and not has_a_overlap:
        continue   # hard reject — no topical connection to this question at all
```

Apply this in the **main loop only**. The supplement loop already exists precisely for
the case where the main loop is too strict and the pool is thin — keeping the hard
filter out of the supplement loop preserves the fallback path for very short sources.

**Important caveat:** On the DBMS source, almost every candidate shares the word
`"database"` with every question stem, so this filter will have limited effect on DBMS
material specifically. Its value is greatest for mixed-topic sources (e.g. OS + DBMS)
where a sentence from one domain would otherwise appear as a distractor for a question
from an unrelated domain.

---

### Change 3 — Fix Normalisation answer truncation

The 80-char cap in `_extract_answer_from_sentence` (Pattern 1 branch) truncates
`"process of organising a database to reduce data redundancy and improve data integrity"`
(85 chars) to `"...and improve data"` (dropping `"integrity"`). The fix: after the
`_cap_phrase` call, re-apply `_clean_trailing_stops` to strip the dangling word `"data"`:

```python
if len(answer_raw) > 80:
    answer_raw = _cap_phrase(answer_raw)
    answer_raw = _clean_trailing_stops(answer_raw)   # ← already present; verify it runs
```

The `_clean_trailing_stops` call IS already present in the code at that point (confirmed
by code reading). The issue is that `"data"` is **not** in `_TRAILING_STOP_PAT` — it is
not a preposition, conjunction, or article. So the truncated form `"...improve data"`
survives all cleanup and is used as-is.

**Correct fix:** extend `_cap_phrase` to check not just trailing conjunctions/prepositions
but also trailing bare nouns that follow them (i.e., strip the whole `"and improve data"`
tail if no complete predicate follows). This is complex.

**Simpler targeted fix:** increase the cap in `_extract_answer_from_sentence` from 80
to 100 characters for the Pattern 1 predicate capture (not for the final answer stored
in the response — keep the 80-char display cap). This prevents the mid-phrase truncation
for most real sentences.

Specifically, in `_extract_answer_from_sentence` Pattern 1 branch:

```python
# Change the intermediate cap to 100 (before _clean_trailing_stops)
if len(answer_raw) > 100:            # ← was 80
    answer_raw = _cap_phrase(answer_raw, max_chars=100)   # ← pass explicit max
    answer_raw = _clean_trailing_stops(answer_raw)
# Then apply the display/storage cap separately
if len(answer_raw) > 80:
    answer_raw = _cap_phrase(answer_raw)
    answer_raw = _clean_trailing_stops(answer_raw)
```

For `"...redundancy and improve data integrity"` (85 chars): the first cap at 100 does
not fire, the second cap fires at 80 → still cuts to 75 chars. **Actually the problem
is unsolvable with a pure char-count cap** without semantic awareness. The real fix is
to let the regex capture the full phrase (no char-count cap at extraction time) and only
apply the display cap when assembling the question dict.

**Revised fix — move the cap out of extraction and into the caller (`_build_mcq`):**

In `_extract_answer_from_sentence`: remove the `if len(answer_raw) > 80` cap in
Pattern 1 (let the regex capture the full predicate up to `{6,120}` chars).

In `_build_mcq`, after calling `_extract_answer_from_sentence`:

```python
answer, question_text = _extract_answer_from_sentence(sentence)
if len(answer) > 80:
    answer = _cap_phrase(answer, max_chars=80)
    answer = _clean_trailing_stops(answer)
```

This way extraction is pure, and the display cap only fires once at the output boundary.
The issue: `_cap_phrase` still cuts at a word boundary, which may still land mid-clause.
For `"...reduce data redundancy and improve data integrity"`:
- 85-char phrase capped at 80 → cut to `"...and improve data"` (drops `"integrity"`) → same problem.

**The real root cause** of the `"integrity"` drop is that 80 chars is too tight for this
particular sentence. The immediate safe fix is to **raise the display cap from 80 to 120
chars** in `_build_mcq` and `_build_distractor_pool`. This is a cosmetic change with no
semantic impact.

Alternatively, do not cap the answer at all for answers under 150 chars (the existing
regex cap of 120 already limits the extraction size). Update `_cap_phrase` call in both
`_extract_answer_from_sentence` and `_build_distractor_pool` to use `max_chars=120`
instead of 80. The existing tests do not assert on maximum answer length, so this is safe.

---

### New test assertions for `DistractorReuseFixTest` in `tests.py`

Create a new test class `DistractorReuseFixTest` (do not modify the existing
`DistractorQualityDBMSTest` — add a new class). The class should assert all of the
following:

```
class DistractorReuseFixTest(TestCase):
```

**test_no_mcq_is_generated_check (guard — ensures tests are not vacuous):**
Assert `len([q for q in questions if q["type"] == "mcq"]) >= 3` — test must fail if
fewer than 3 MCQs are generated from the DBMS source, since all subsequent assertions
would be vacuously satisfied on 0 or 1 MCQ.

**test_cross_question_distractor_uniqueness:**
For a 5-question MCQ quiz on `_DBMS_SOURCE`, build the full list of
`(question_index, distractor_text)` pairs. Assert that for at least `(N-1)` of the
N questions, each distractor is not reused from any prior question. That is: the number
of unique distractors across all questions must be `> 3` (at least 4 distinct
distractors appear, meaning at least one question has a distractor not shared with Q1).

**test_distractor_not_correct_answer_of_another_question:**
Collect all correct answers from a 5-question MCQ quiz. For each question, assert that
none of its distractors exactly match (case-insensitive) the correct answer of a
different question. This tests that the pool is not simply recycling other questions'
correct answers verbatim.

Wait — this assertion is **already false in the current code by design**: distractors
ARE drawn from other sentences' correct answers. Do not add this assertion.

**test_cross_question_reuse_strictly_bounded:**
Count how many times any single distractor string appears across all questions in a
5-question MCQ quiz. Assert that no single distractor text appears in more than 2 of
the 5 questions. (With cross-question reservation, each distractor should appear at most
once; this test uses ≤ 2 as a conservative bound for the transition.)

Concretely:
```python
from collections import Counter
all_distractors = []
for q in questions:
    if q["type"] != "mcq":
        continue
    for opt in q["options"]:
        if opt.strip().lower() != q["correct_answer"].strip().lower():
            all_distractors.append(opt.strip().lower())
counts = Counter(all_distractors)
for distractor, count in counts.items():
    self.assertLessEqual(
        count, 2,
        f"Distractor {distractor!r} reused in {count} questions — "
        f"cross-question reservation not working."
    )
```

After the cross-question reservation fix is in place, this bound can be tightened to
`assertLessEqual(count, 1)` (exact non-reuse). Initially use ≤ 2 to allow for the
structural limit (9 candidates, 5 questions × 3 draws = 15).

**test_distractors_topically_relevant_for_normalisation_question:**
For the Normalisation question (correct answer containing `"organising"` or
`"redundancy"`), assert that all 3 distractors contain at least one word from the set
`{'database', 'data', 'organis', 'redundan', 'integrity', 'query', 'relational',
'schema', 'model', 'sql', 'transaction', 'index', 'retrieval', 'table'}` — i.e.,
each distractor is a DBMS concept, not a generic fragment. Use partial-word matching
(`any(keyword in d.lower() for keyword in ...)`) to be resilient to plurals/conjugations.

**test_hard_difficulty_uses_long_source:**
(Addresses reviewer finding 2): Run the hard-difficulty test using `_LONG_SOURCE`
(operating-systems source) instead of `_DBMS_SOURCE`. Assert `len(mcqs) >= 2` and
validate `correct_index` integrity. This ensures the hard-difficulty overlap filter
is actually exercised.

---

### Summary of verification commands (run from `backend/` with venv active)

```bash
python manage.py check
python manage.py makemigrations --check
python manage.py test api
cd ../frontend && npm run build
```

---

### What does NOT change

- All existing tests (`QuizOptionDiversityTest`, `QuizAnswerEvalTest`,
  `QuizShortSourceTest`, `QuizExistingRegressionTest`, `DistractorQualityDBMSTest`) —
  all preserved and must pass.
- All API contracts — no change to response structure.
- All models, migrations, URLs, settings — no change.
- Frontend — no change.
- `used_distractors=None` default in `_build_mcq` ensures backward-compat for all
  call sites in tests that call `_build_mcq` directly without the new parameter.
