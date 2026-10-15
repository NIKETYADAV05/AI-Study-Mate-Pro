# Quiz Fix Plan — Repeated Answer-Options Bug

## Root Cause

### Primary bug — shared distractor pool (`views.py` ~line 1637)

Inside `_assemble_quiz`, `_build_distractor_pool` is called **once** before the
per-question loop, with `correct_answer=""`:

```python
# BUGGY — called once, shared across every MCQ
dist_pool = _build_distractor_pool(
    all_sentences, freq,
    correct_answer="",   # ← empty string: similarity gate is meaningless
    difficulty=difficulty,
)
for sentence in source_sentences:
    q = _build_mcq(sentence, dist_pool, difficulty, used_questions)
```

`_build_mcq` then iterates this **single, fixed-order** list and takes the
first three candidates that survive its filter.  Because the pool order never
changes, every question draws from the same leading items — producing near-
identical option sets across all MCQs.

### Secondary bug — meaningless similarity gate in `_build_distractor_pool`

When `correct_answer=""`, `correct_lower` and `correct_words` are both empty.
Every candidate trivially passes the overlap check (`overlap = 0 / 1 = 0`).
The pool is therefore populated without any filtering against the actual correct
answer of each question, which means distractors that are semantically identical
to the real answer are freely admitted.

### Frontend confirmation — no bug here

`Quiz.js` renders options as `q.options[i]` and evaluates answers with
`answers[i] === q.correct_index`. The backend sets `correct_index` via
`options.index(answer)` **after** `random.shuffle(options)`, so the index
always points to the shuffled position of the correct answer. This mechanism
is correct and will remain correct after the backend change.

---

## Changes Required

### No model changes — no migrations needed

This is a pure logic fix inside existing functions.  The API response structure
(`questions`, `warnings`, `total`, `difficulty`, `quiz_type`) is unchanged.
`Quiz.js` does not need any edits.

---

## Implementation Plan

- [ ] 1. Change `_build_mcq` signature to accept raw NLP inputs instead of a pre-built pool.

      Current signature (line 1378–1383):
      ```python
      def _build_mcq(
          sentence: str,
          distractor_pool: list[str],
          difficulty: str,
          used_questions: set[str],
      ) -> dict | None:
      ```

      New signature:
      ```python
      def _build_mcq(
          sentence: str,
          all_sentences: list[str],
          freq: Counter,
          difficulty: str,
          used_questions: set[str],
      ) -> dict | None:
      ```

      Inside `_build_mcq`, after the `answer` is extracted (currently line ~1390),
      call `_build_distractor_pool` with the real correct answer:

      ```python
      # NEW: build per-question pool filtered against THIS question's answer
      distractor_pool = _build_distractor_pool(
          all_sentences, freq,
          correct_answer=answer,
          difficulty=difficulty,
      )
      ```

      The rest of the function (`# Pick 3 distractors …` loop onward) is unchanged.

      Files: `backend/api/views.py` (lines 1378–1443)

      Verify: `cd backend && python manage.py check` — no errors.

- [ ] 2. Remove the shared pool from `_assemble_quiz` and pass NLP inputs to `_build_mcq`.

      In `_assemble_quiz` (lines ~1636–1648), replace:
      ```python
      # REMOVE these three lines:
      dist_pool = _build_distractor_pool(
          all_sentences, freq,
          correct_answer="",  # empty — build global pool
          difficulty=difficulty,
      )
      for sentence in source_sentences:
          if len(questions) >= mcq_target:
              break
          q = _build_mcq(sentence, dist_pool, difficulty, used_questions)
      ```

      With:
      ```python
      # NEW: no shared pool; each call to _build_mcq builds its own pool
      for sentence in source_sentences:
          if len(questions) >= mcq_target:
              break
          q = _build_mcq(sentence, all_sentences, freq, difficulty, used_questions)
      ```

      Files: `backend/api/views.py` (lines ~1636–1648)

      Verify: `cd backend && python manage.py check` — no errors.

- [ ] 3. Add intra-question deduplication inside `_build_mcq`.

      Directly before `random.shuffle(options)` (currently the line after
      `options = [answer] + distractors`), add a normalised dedup pass:

      ```python
      # Deduplicate options within this question (case-insensitive, strip whitespace)
      seen_opts: set[str] = set()
      unique_options: list[str] = []
      for opt in options:
          norm = opt.strip().lower()
          if norm not in seen_opts:
              seen_opts.add(norm)
              unique_options.append(opt)
      options = unique_options

      # Ensure the correct answer is still present (it always should be,
      # but guard defensively)
      if answer not in options:
          return None

      # Need exactly 4 options for a usable MCQ; fall back if dedup reduced below 4
      if len(options) < 4:
          return None
      ```

      Then replace `options = [answer] + distractors` and `random.shuffle(options)`
      so the flow becomes:
      ```python
      options = [answer] + distractors
      # ↑ dedup block goes here (see above)
      random.shuffle(options)
      correct_index = options.index(answer)
      ```

      This ensures: no duplicate options within a question, correct answer
      appears exactly once, and the function returns `None` (skipped) rather
      than emitting a bad question when dedup leaves fewer than 4 options.

      Files: `backend/api/views.py` (lines ~1430–1443)

      Verify: `cd backend && python manage.py check` — no errors.

- [ ] 4. Confirm `_build_distractor_pool` needs no changes.

      The function already uses `correct_answer` to gate similarity (`correct_lower`,
      `correct_words`, and the `seen_lower.add(correct_lower[:60])` initialisation).
      The only reason it was broken was the caller passing `""`. No edits are needed
      to this function.

      Files: `backend/api/views.py` (lines 1273–1375) — read-only confirmation.

      Verify: mental / code-review only; no separate test command needed.

- [ ] 5. Append regression tests to `backend/api/tests.py`.

      **Do NOT replace the existing file.** Open it and append four new test classes
      after the existing `# Create your tests here.` comment (the file currently has
      only that placeholder).

      Test source text to use (a long enough passage with varied sentences — define
      as a module-level constant `_LONG_SOURCE` in the test file):

      ```python
      _LONG_SOURCE = """
      The operating system is a program that manages computer hardware and software
      resources. It acts as an intermediary between users and the computer hardware.
      The kernel is the core part of an operating system that has complete control
      over everything in the system. Process management involves creating, scheduling,
      and terminating processes. A process is a program in execution that requires
      CPU time and memory. Memory management ensures that each process has enough
      memory to execute and does not interfere with other processes. Virtual memory
      allows a computer to compensate for physical memory shortages by temporarily
      transferring data to disk storage. The file system organises data into files
      and directories on storage devices. Device drivers act as translators between
      the operating system and hardware devices. Scheduling algorithms determine
      which process runs on the CPU at a given time. Deadlock occurs when two or
      more processes are waiting indefinitely for resources held by each other.
      Semaphores are synchronisation tools used to prevent race conditions.
      Paging divides memory into fixed-size blocks called pages.
      Segmentation divides memory into variable-size segments based on logical units.
      """
      ```

      ### Class A — `QuizOptionDiversityTest`

      ```python
      class QuizOptionDiversityTest(TestCase):
          """Verify MCQ options are not repeated within or across questions."""

          def _generate_mcq(self, text=_LONG_SOURCE, count=5, difficulty="medium"):
              from api.views import (
                  clean_text, split_into_sentences, compute_freq,
                  score_sentences, _assemble_quiz,
              )
              cleaned = clean_text(text)
              sents   = split_into_sentences(cleaned)
              freq    = compute_freq(sents)
              scores  = score_sentences(sents, freq)
              questions, _ = _assemble_quiz(
                  sents, freq, scores,
                  quiz_type="mcq", count=count, difficulty=difficulty,
              )
              return questions

          def test_no_duplicate_options_within_question(self):
              """Every option within a single MCQ must be unique (case-insensitive)."""
              questions = self._generate_mcq()
              for q in questions:
                  if q["type"] != "mcq":
                      continue
                  opts_lower = [o.strip().lower() for o in q["options"]]
                  self.assertEqual(
                      len(opts_lower), len(set(opts_lower)),
                      f"Duplicate options found in question: {q['question']!r}\n"
                      f"Options: {q['options']}",
                  )

          def test_correct_answer_appears_exactly_once(self):
              """The correct answer text must appear exactly once in each MCQ's options."""
              questions = self._generate_mcq()
              for q in questions:
                  if q["type"] != "mcq":
                      continue
                  answer = q["correct_answer"].strip().lower()
                  occurrences = sum(
                      1 for o in q["options"] if o.strip().lower() == answer
                  )
                  self.assertEqual(
                      occurrences, 1,
                      f"Correct answer appears {occurrences} times in question: "
                      f"{q['question']!r}",
                  )

          def test_options_not_identical_across_all_questions(self):
              """
              With a long source, different MCQs must not all share the same option set.
              At least one question must have an option set distinct from the first.
              """
              questions = self._generate_mcq(count=5)
              mcqs = [q for q in questions if q["type"] == "mcq"]
              if len(mcqs) < 2:
                  self.skipTest("Not enough MCQs generated to compare.")
              first_opts = frozenset(o.strip().lower() for o in mcqs[0]["options"])
              all_same = all(
                  frozenset(o.strip().lower() for o in q["options"]) == first_opts
                  for q in mcqs[1:]
              )
              self.assertFalse(
                  all_same,
                  "All MCQs share exactly the same option set — "
                  "per-question distractor pool is not working.",
              )

          def test_correct_index_points_to_correct_answer(self):
              """correct_index must index into options and equal correct_answer."""
              questions = self._generate_mcq()
              for q in questions:
                  if q["type"] != "mcq":
                      continue
                  self.assertLess(
                      q["correct_index"], len(q["options"]),
                      "correct_index out of range.",
                  )
                  self.assertEqual(
                      q["options"][q["correct_index"]].strip().lower(),
                      q["correct_answer"].strip().lower(),
                      f"correct_index does not point to correct_answer in: "
                      f"{q['question']!r}",
                  )
      ```

      ### Class B — `QuizAnswerEvalTest`

      ```python
      class QuizAnswerEvalTest(TestCase):
          """Verify shuffle never breaks answer evaluation."""

          def test_correct_index_survives_multiple_generations(self):
              """
              Generate the same quiz five times (random.shuffle differs each run).
              Each time, options[correct_index] must equal correct_answer.
              """
              from api.views import (
                  clean_text, split_into_sentences, compute_freq,
                  score_sentences, _assemble_quiz,
              )
              cleaned = clean_text(_LONG_SOURCE)
              sents   = split_into_sentences(cleaned)
              freq    = compute_freq(sents)
              scores  = score_sentences(sents, freq)

              for _run in range(5):
                  questions, _ = _assemble_quiz(
                      sents, freq, scores,
                      quiz_type="mcq", count=5, difficulty="medium",
                  )
                  for q in questions:
                      if q["type"] != "mcq":
                          continue
                      idx = q["correct_index"]
                      self.assertLess(idx, len(q["options"]))
                      self.assertEqual(
                          q["options"][idx].strip().lower(),
                          q["correct_answer"].strip().lower(),
                          f"Shuffle broke correct_index on run {_run}: "
                          f"{q['question']!r}",
                      )
      ```

      ### Class C — `QuizShortSourceTest`

      ```python
      _SHORT_SOURCE = "The CPU executes program instructions stored in memory."

      class QuizShortSourceTest(TestCase):
          """Short source text should not crash — graceful fallback only."""

          def test_short_source_does_not_crash(self):
              """
              A source too short for MCQs must return an empty list or a warning,
              never raise an unhandled exception.
              """
              from api.views import (
                  clean_text, split_into_sentences, compute_freq,
                  score_sentences, _assemble_quiz,
              )
              cleaned = clean_text(_SHORT_SOURCE)
              sents   = split_into_sentences(cleaned)
              freq    = compute_freq(sents)
              scores  = score_sentences(sents, freq)
              # Must not raise
              questions, warnings = _assemble_quiz(
                  sents, freq, scores,
                  quiz_type="mcq", count=5, difficulty="medium",
              )
              # Either no questions or at least one warning explaining the shortfall
              if not questions:
                  self.assertTrue(
                      len(warnings) > 0,
                      "Empty question list with no warning is a silent failure.",
                  )
              # If any questions were generated, they must still be structurally valid
              for q in questions:
                  self.assertIn("options", q)
                  self.assertIn("correct_index", q)
                  self.assertLess(q["correct_index"], len(q["options"]))
      ```

      ### Class D — `QuizExistingRegressionTest`

      ```python
      class QuizExistingRegressionTest(TestCase):
          """Smoke-test the full quiz API endpoint for structural correctness."""

          def test_quiz_endpoint_returns_200_and_valid_structure(self):
              """POST /api/quiz/ with a standard input returns 200 and valid JSON."""
              import json
              response = self.client.post(
                  "/api/quiz/",
                  data=json.dumps({
                      "text":       _LONG_SOURCE,
                      "count":      5,
                      "difficulty": "medium",
                      "quiz_type":  "mixed",
                  }),
                  content_type="application/json",
              )
              self.assertEqual(response.status_code, 200)
              data = response.json()
              self.assertIn("questions", data)
              self.assertIn("warnings", data)
              self.assertIn("total", data)
              self.assertGreater(len(data["questions"]), 0)
              for q in data["questions"]:
                  self.assertIn("type", q)
                  self.assertIn("question", q)
                  self.assertIn("options", q)
                  self.assertIn("correct_index", q)
                  self.assertIn("correct_answer", q)
                  self.assertIn("explanation", q)
                  # correct_index must be in-range
                  self.assertLess(q["correct_index"], len(q["options"]))
                  # correct answer must be at correct_index
                  self.assertEqual(
                      q["options"][q["correct_index"]].strip().lower(),
                      q["correct_answer"].strip().lower(),
                  )

          def test_quiz_endpoint_rejects_short_input(self):
              """POST /api/quiz/ with text under 80 chars returns 422."""
              import json
              response = self.client.post(
                  "/api/quiz/",
                  data=json.dumps({"text": "Too short.", "count": 5,
                                   "difficulty": "medium", "quiz_type": "mixed"}),
                  content_type="application/json",
              )
              self.assertEqual(response.status_code, 422)
      ```

      Files: `backend/api/tests.py` — append only, do not replace.

      Verify: `cd backend && python manage.py test api` — all new tests pass,
      existing tests (the placeholder `TestCase` base class) are unaffected.

---

## Verification Steps (run in order)

All commands assume the working directory is `backend/` and the virtualenv
is activated (`venv\Scripts\activate` on Windows).

```bash
# 1. Django system check — no configuration errors
python manage.py check

# 2. Migration check — no unapplied or new migrations (pure logic change)
python manage.py makemigrations --check

# 3. Full backend test suite — all tests must pass
python manage.py test api

# 4. Frontend build — must succeed with no errors
cd ../frontend && npm run build
```

Expected outcomes:
- `python manage.py check` → `System check identified no issues (0 silenced).`
- `makemigrations --check` → `No changes detected` (no model changes were made)
- `python manage.py test api` → all tests pass, including the four new classes
- `npm run build` → exits 0, no type or lint errors (no frontend changes were made)

---

## What does NOT change

- `Quiz.js` — no edits. The frontend's evaluation logic (`answers[i] === q.correct_index`)
  is already correct and shuffle-safe because the backend sets `correct_index =
  options.index(answer)` after shuffle. This is confirmed correct and unchanged.
- All models (`QuizAttempt`, `StudyTask`, `Note`, `DailyQuestLog`) — no edits.
- All other views (`summarize`, notes, tasks, revision plan, quiz attempts) — no edits.
- The API response envelope (`questions`, `warnings`, `total`, `difficulty`, `quiz_type`) — unchanged.
- No new dependencies — only Python stdlib and Django.

---

## Remaining Limitations (after the fix)

- **Thin source texts** (< ~8 quiz-worthy sentences): the per-question pool may
  still be small. `_build_mcq` returns `None` when it cannot find 3 distinct
  distractors, so the quiz silently falls short of the requested count and appends
  a warning. This is the correct existing behaviour and is tested by `QuizShortSourceTest`.
- **Semantically homogeneous documents** (e.g. a single-topic paragraph where every
  sentence describes the same thing): distractors will still resemble each other
  because the document itself is repetitive. No purely extractive system can
  overcome this without inventing facts.
- **No browser testing was performed** — the fix is backend-only; frontend rendering
  is unchanged.
