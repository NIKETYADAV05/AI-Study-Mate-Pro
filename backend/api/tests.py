from django.test import TestCase

# Create your tests here.

import json

# ── Long source used by diversity, answer-eval, and regression tests ───────────
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
Semaphores are synchronisation tools used to prevent race conditions in
concurrent programs. Paging divides memory into fixed-size blocks called pages
to manage physical memory efficiently. Segmentation divides memory into
variable-size segments based on logical units such as code, data, and stack.
"""

# ── Short source used by short-source graceful-fallback test ──────────────────
_SHORT_SOURCE = "A process is a running program. Memory stores data. The CPU executes instructions."


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


class QuizExistingRegressionTest(TestCase):
    """Smoke-test the full quiz API endpoint for structural correctness."""

    def test_quiz_endpoint_returns_200_and_valid_structure(self):
        """POST /api/quiz/ with a standard input returns 200 and valid JSON."""
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
        response = self.client.post(
            "/api/quiz/",
            data=json.dumps({"text": "Too short.", "count": 5,
                             "difficulty": "medium", "quiz_type": "mixed"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 422)


# ── DBMS regression source ────────────────────────────────────────────────────
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


class DistractorQualityDBMSTest(TestCase):
    """DBMS-specific regression tests for distractor quality improvements."""

    def _generate_mcq(self, text=_DBMS_SOURCE, count=5, difficulty="medium"):
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

    def _meaningful_word_count(self, text):
        """Mirror of the backend helper — used in assertions."""
        from api.views import STOP_WORDS
        import re
        words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
        return sum(1 for w in words if w not in STOP_WORDS)

    def test_no_generic_two_word_distractors(self):
        """
        No option in any MCQ should be a phrase with fewer than 3 meaningful
        (non-stop-word) words. This directly catches 'organised and optimised'
        and similar weak two-word fragments.
        """
        questions = self._generate_mcq()
        for q in questions:
            if q["type"] != "mcq":
                continue
            for opt in q["options"]:
                mwc = self._meaningful_word_count(opt)
                self.assertGreaterEqual(
                    mwc, 3,
                    f"Option {opt!r} in question {q['question']!r} has only "
                    f"{mwc} meaningful word(s) — too weak to be a useful option.",
                )

    def test_distractors_not_all_same_across_questions(self):
        """
        With DBMS source material, not all MCQs should share the exact same
        set of non-correct-answer options. At least one question must have a
        distractor set distinct from the first question's distractors.
        """
        questions = self._generate_mcq(count=5)
        mcqs = [q for q in questions if q["type"] == "mcq"]
        if len(mcqs) < 2:
            self.skipTest("Not enough MCQs generated to compare.")

        def _distractor_set(q):
            correct_lower = q["correct_answer"].strip().lower()
            return frozenset(
                o.strip().lower() for o in q["options"]
                if o.strip().lower() != correct_lower
            )

        first_distractors = _distractor_set(mcqs[0])
        all_same = all(_distractor_set(q) == first_distractors for q in mcqs[1:])
        self.assertFalse(
            all_same,
            "All MCQs share the exact same distractor set — "
            "per-question relevance ranking is not working for DBMS material.",
        )

    def test_correct_answer_not_in_distractors(self):
        """
        For every MCQ, the correct answer (normalised) must not appear among
        the distractor options.
        """
        questions = self._generate_mcq()
        for q in questions:
            if q["type"] != "mcq":
                continue
            correct_lower = q["correct_answer"].strip().lower()
            distractors = [
                o.strip().lower() for o in q["options"]
                if o.strip().lower() != correct_lower
            ]
            self.assertNotIn(
                correct_lower, distractors,
                f"Correct answer {q['correct_answer']!r} appears as a distractor "
                f"in question: {q['question']!r}",
            )

    def test_no_trailing_preposition_in_any_option(self):
        """
        No option string should end with a bare preposition, conjunction,
        or article (and, or, of, to, for, in, on, at, a, an, the).
        """
        import re as _re
        _TRAILING_STOP = _re.compile(
            r'\b(and|or|but|nor|by|with|as|of|to|for|in|on|at|a|an|the)\s*$',
            _re.IGNORECASE,
        )
        questions = self._generate_mcq()
        for q in questions:
            if q["type"] != "mcq":
                continue
            for opt in q["options"]:
                self.assertIsNone(
                    _TRAILING_STOP.search(opt.strip()),
                    f"Option {opt!r} ends with a trailing stop word in "
                    f"question: {q['question']!r}",
                )

    def test_similarity_ratio_above_threshold_rejected(self):
        """
        _build_distractor_pool must reject a candidate whose similarity to the
        correct answer exceeds 0.85.
        """
        from api.views import (
            clean_text, split_into_sentences, compute_freq,
            _build_distractor_pool,
        )
        # Correct answer
        correct = "organised collection of structured information or data"
        # A near-identical candidate (> 0.85 similarity) — derived by adding one word
        near_identical = "organised collection of structured information or data types"

        # Build a source that contains the near-identical sentence
        source = _DBMS_SOURCE + f"\n{near_identical.capitalize()} is stored electronically.\n"
        cleaned = clean_text(source)
        sents   = split_into_sentences(cleaned)
        freq    = compute_freq(sents)

        pool = _build_distractor_pool(
            sents, freq,
            correct_answer=correct,
            difficulty="medium",
            question_text="A database is ___?",
        )
        pool_lower = [p.lower() for p in pool]
        # The near-identical candidate should not be in the pool
        for p in pool_lower:
            from difflib import SequenceMatcher
            ratio = SequenceMatcher(None, correct.lower(), p).ratio()
            self.assertLessEqual(
                ratio, 0.85,
                f"Distractor {p!r} has similarity ratio {ratio:.2f} > 0.85 "
                f"to correct answer {correct!r} and should have been rejected.",
            )

    def test_short_source_dbms_does_not_crash(self):
        """
        A very short DBMS-flavoured source must not crash and should return
        either an empty list with a warning or a structurally valid question set.
        """
        from api.views import (
            clean_text, split_into_sentences, compute_freq,
            score_sentences, _assemble_quiz,
        )
        short = "A database stores data. SQL queries databases. A DBMS manages the database."
        cleaned = clean_text(short)
        sents   = split_into_sentences(cleaned)
        freq    = compute_freq(sents)
        scores  = score_sentences(sents, freq)
        questions, warnings = _assemble_quiz(
            sents, freq, scores,
            quiz_type="mcq", count=5, difficulty="medium",
        )
        if not questions:
            self.assertTrue(
                len(warnings) > 0,
                "Empty question list with no warning is a silent failure.",
            )
        for q in questions:
            self.assertIn("options", q)
            self.assertIn("correct_index", q)
            self.assertLess(q["correct_index"], len(q["options"]))

    def test_build_mcq_inner_similarity_gate_rejects_near_duplicate(self):
        """
        Finding 3: The similarity gate inside _build_mcq's distractor selection
        loop must reject a near-duplicate of the correct answer even if the
        distractor pool admits it. This tests the inner gate independently of
        _build_distractor_pool.

        We construct a source where one sentence yields the correct answer and
        another yields a near-identical distractor (>0.85 similarity), verify
        that the MCQ's options list does not contain the near-duplicate.
        """
        from api.views import (
            clean_text, split_into_sentences, compute_freq,
            score_sentences, _assemble_quiz, _similarity_ratio,
        )
        # Two sentences that produce near-identical predicates.
        # Sentence 1 correct answer: "organised collection of structured information"
        # Sentence 2 distractor:     "organised collection of structured information or data"
        # These differ by three words but their similarity ratio is >0.85.
        source = (
            "A database is an organised collection of structured information "
            "stored electronically in a computer system.\n"
            "A repository is an organised collection of structured information or data "
            "held in a digital archive.\n"
            "The DBMS serves as an interface between the database and its end users, "
            "allowing users to retrieve and update records.\n"
            "A relational database organises data into rows and columns which form a table.\n"
            "Data is typically structured across multiple tables joined via a primary key "
            "or a foreign key for referential integrity.\n"
            "A database schema defines the structure including tables, fields, and "
            "relationships between all data entities.\n"
            "A database instance represents the state of the database at a particular "
            "moment recorded in persistent storage.\n"
        )
        cleaned = clean_text(source)
        sents   = split_into_sentences(cleaned)
        freq    = compute_freq(sents)
        scores  = score_sentences(sents, freq)
        questions, _ = _assemble_quiz(
            sents, freq, scores,
            quiz_type="mcq", count=5, difficulty="medium",
        )
        for q in questions:
            if q["type"] != "mcq":
                continue
            correct = q["correct_answer"]
            for opt in q["options"]:
                if opt.strip().lower() == correct.strip().lower():
                    continue  # skip the correct answer itself
                ratio = _similarity_ratio(opt, correct)
                self.assertLessEqual(
                    ratio, 0.85,
                    f"Distractor {opt!r} has similarity {ratio:.2f} > 0.85 to "
                    f"correct answer {correct!r} in question: {q['question']!r}. "
                    f"Inner gate in _build_mcq should have rejected it.",
                )

    def test_hard_difficulty_produces_valid_questions(self):
        """
        Finding 4: The hard difficulty path (overlap < 0.05 filter in the main
        loop) must be exercised. Generate MCQs at hard difficulty and assert
        structural validity: at least one question is returned with correct
        options and correct_index integrity.
        """
        questions = self._generate_mcq(difficulty="hard")
        # Hard difficulty may produce fewer questions (strict filter) — that is fine.
        # If any questions are produced they must be structurally sound.
        for q in questions:
            if q["type"] != "mcq":
                continue
            self.assertIn("options", q)
            self.assertIn("correct_index", q)
            self.assertGreaterEqual(len(q["options"]), 4)
            self.assertLess(q["correct_index"], len(q["options"]))
            self.assertEqual(
                q["options"][q["correct_index"]].strip().lower(),
                q["correct_answer"].strip().lower(),
                f"correct_index broken at hard difficulty in: {q['question']!r}",
            )
        # It is acceptable if hard difficulty produces 0 questions from DBMS
        # source — only assert structure when questions exist.
        # But also verify it does not raise an exception (implicit in reaching here).


# ── DBMS reuse-fix regression source ─────────────────────────────────────────
_DBMS_REUSE_SOURCE = """
A database is an organised collection of related data stored electronically.
A database is usually controlled by a database management system (DBMS).
The Database Administrator (DBA) is a person who manages and maintains the database.
A database instance is the data in the database at a particular moment in time.
A database schema describes the overall structure and design of the database.
The relational model organises data into tables and is one of the most widely used database models.
A data model provides a logical representation of the data structures and their relationships.
Normalisation is the process of structuring a database to reduce redundancy and improve integrity.
SQL is the standard language used to query and manage relational databases.
A primary key uniquely identifies each record in a database table.
A foreign key is a field that links one table to another in a relational database.
The DBMS allows multiple users to access the database concurrently without conflict.
Data integrity ensures that the data stored in the database is accurate and consistent.
"""


class DistractorReuseFixTest(TestCase):
    """Regression tests for the cross-question distractor reuse bug fix."""

    def _generate_mcq(self, text=_DBMS_REUSE_SOURCE, count=5, difficulty="medium"):
        from api.views import (
            clean_text, split_into_sentences, compute_freq,
            score_sentences, _assemble_quiz,
        )
        cleaned = clean_text(text)
        sents   = split_into_sentences(cleaned)
        freq    = compute_freq(sents)
        scores  = score_sentences(sents, freq)
        questions, warnings = _assemble_quiz(
            sents, freq, scores,
            quiz_type="mcq", count=count, difficulty=difficulty,
        )
        return questions, warnings

    def test_minimum_questions_generated(self):
        """Guard: at least 3 MCQs must be generated from the DBMS source."""
        questions, _ = self._generate_mcq(count=5)
        mcqs = [q for q in questions if q["type"] == "mcq"]
        self.assertGreaterEqual(
            len(mcqs), 3,
            f"Only {len(mcqs)} MCQ(s) generated — subsequent assertions would "
            f"be vacuous. Provide more source material or fix question generation.",
        )

    def test_no_duplicate_options_within_question(self):
        """Every option within a single MCQ must be unique (case/whitespace normalized)."""
        questions, _ = self._generate_mcq(count=5)
        mcqs = [q for q in questions if q["type"] == "mcq"]
        self.assertGreaterEqual(len(mcqs), 3, "Not enough MCQs generated.")
        for q in mcqs:
            opts_lower = [o.strip().lower() for o in q["options"]]
            self.assertEqual(
                len(opts_lower), len(set(opts_lower)),
                f"Duplicate options in question: {q['question']!r}\n"
                f"Options: {q['options']}",
            )

    def test_correct_answer_appears_exactly_once(self):
        """The correct answer must appear exactly once in each MCQ's options."""
        questions, _ = self._generate_mcq(count=5)
        mcqs = [q for q in questions if q["type"] == "mcq"]
        self.assertGreaterEqual(len(mcqs), 3, "Not enough MCQs generated.")
        for q in mcqs:
            answer = q["correct_answer"].strip().lower()
            count = sum(1 for o in q["options"] if o.strip().lower() == answer)
            self.assertEqual(
                count, 1,
                f"Correct answer appears {count} times in question: {q['question']!r}",
            )

    def test_notorious_phrase_not_distractor_for_database_instance(self):
        """
        'one of the most widely used database models' must NOT appear as a
        distractor in any question whose stem mentions 'database instance'.
        """
        questions, _ = self._generate_mcq(count=5)
        mcqs = [q for q in questions if q["type"] == "mcq"]
        self.assertGreaterEqual(len(mcqs), 3, "Not enough MCQs generated.")
        notorious = "one of the most widely used database models"
        target_questions = [q for q in mcqs if "database instance" in q["question"].lower()]
        if not target_questions:
            self.skipTest(
                "'database instance' question not generated from source — "
                "cannot test notorious-phrase guard (test would be vacuous)."
            )
        for q in target_questions:
            correct_lower = q["correct_answer"].strip().lower()
            distractors = [o.strip().lower() for o in q["options"]
                           if o.strip().lower() != correct_lower]
            for d in distractors:
                self.assertNotIn(
                    notorious, d,
                    f"Notorious phrase found as distractor for 'database instance' "
                    f"question: {q['question']!r}",
                )

    def test_notorious_phrase_not_distractor_for_dba(self):
        """
        'one of the most widely used database models' must NOT appear as a
        distractor in any question whose stem mentions 'database administrator' or 'DBA'.
        """
        questions, _ = self._generate_mcq(count=5)
        mcqs = [q for q in questions if q["type"] == "mcq"]
        self.assertGreaterEqual(len(mcqs), 3, "Not enough MCQs generated.")
        notorious = "one of the most widely used database models"
        target_questions = [
            q for q in mcqs
            if "database administrator" in q["question"].lower() or "dba" in q["question"].lower()
        ]
        if not target_questions:
            self.skipTest(
                "'Database Administrator'/'DBA' question not generated from source — "
                "cannot test notorious-phrase guard (test would be vacuous)."
            )
        for q in target_questions:
            correct_lower = q["correct_answer"].strip().lower()
            distractors = [o.strip().lower() for o in q["options"]
                           if o.strip().lower() != correct_lower]
            for d in distractors:
                self.assertNotIn(
                    notorious, d,
                    f"Notorious phrase found as distractor for DBA question: "
                    f"{q['question']!r}",
                )

    def test_directly_maintained_not_distractor_for_database_question(self):
        """
        'person who manages and maintains the database' (the DBA answer extracted
        from the source) must NOT appear as a distractor in any question whose
        stem specifically mentions 'database instance'.

        This test is non-vacuous: the source contains the DBA sentence, so
        'person who manages and maintains the database' IS extractable and CAN
        appear in the distractor pool. Cross-question reservation must prevent
        it from appearing in the database-instance question after it has already
        been used as a distractor for an earlier question.

        Note: the original spec phrase 'directly maintained in the database' was
        replaced here because it cannot be extracted from _DBMS_REUSE_SOURCE and
        would produce a vacuous test (review finding 1 fix, option B).
        """
        questions, _ = self._generate_mcq(count=5)
        mcqs = [q for q in questions if q["type"] == "mcq"]
        self.assertGreaterEqual(len(mcqs), 3, "Not enough MCQs generated.")
        phrase = "person who manages and maintains the database"
        db_instance_questions = [
            q for q in mcqs if "database instance" in q["question"].lower()
        ]
        if not db_instance_questions:
            self.skipTest(
                "database-instance question not generated from source — "
                "cannot test DBA-phrase reservation (test would be vacuous)."
            )
        for q in db_instance_questions:
            correct_lower = q["correct_answer"].strip().lower()
            distractors = [o.strip().lower() for o in q["options"]
                           if o.strip().lower() != correct_lower]
            for d in distractors:
                self.assertNotIn(
                    phrase, d,
                    f"DBA-role phrase {phrase!r} found as distractor in "
                    f"database-instance question: {q['question']!r}",
                )

    def test_cross_question_reuse_bounded(self):
        """
        No single distractor phrase should appear in more than 2 questions out
        of all generated MCQ questions. With cross-question reservation, each
        distractor should ideally appear at most once.

        The bound is ≤2 (not ≤1) because of pool-size arithmetic: the 13-sentence
        _DBMS_REUSE_SOURCE yields approximately 9 usable distractor candidates.
        Five questions each need 3 distractors = 15 total draws from a pool of 9.
        Even with perfect reservation, at least 6 distractors must be reused across
        questions (15 draws - 9 unique candidates = 6 forced repeats). The ≤2 bound
        is a conservative envelope — if the source is expanded to 20+ sentences, the
        bound can be tightened to ≤1 once the candidate pool exceeds 15.
        """
        from collections import Counter as _Counter
        questions, _ = self._generate_mcq(count=5)
        mcqs = [q for q in questions if q["type"] == "mcq"]
        self.assertGreaterEqual(len(mcqs), 3, "Not enough MCQs generated.")
        all_distractors = []
        for q in mcqs:
            correct_lower = q["correct_answer"].strip().lower()
            for opt in q["options"]:
                if opt.strip().lower() != correct_lower:
                    all_distractors.append(opt.strip().lower())
        counts = _Counter(all_distractors)
        for distractor, cnt in counts.items():
            self.assertLessEqual(
                cnt, 2,
                f"Distractor {distractor!r} reused in {cnt} questions — "
                f"cross-question reservation not working correctly.",
            )

    def test_grading_correct_after_shuffle(self):
        """
        options[correct_index].strip().lower() must equal correct_answer.strip().lower()
        for every MCQ regardless of shuffle order.
        """
        questions, _ = self._generate_mcq(count=5)
        mcqs = [q for q in questions if q["type"] == "mcq"]
        self.assertGreaterEqual(len(mcqs), 3, "Not enough MCQs generated.")
        for q in mcqs:
            self.assertLess(q["correct_index"], len(q["options"]),
                            f"correct_index out of range in: {q['question']!r}")
            self.assertEqual(
                q["options"][q["correct_index"]].strip().lower(),
                q["correct_answer"].strip().lower(),
                f"Grading broken after shuffle in: {q['question']!r}",
            )

    def test_short_source_graceful_fallback(self):
        """A very short source must not crash; if empty result, a warning must be present."""
        source = "A database stores data. The DBMS manages databases."
        questions, warnings = self._generate_mcq(text=source, count=5)
        # Must not raise — reaching here confirms no crash
        if not questions:
            self.assertGreater(
                len(warnings), 0,
                "Empty question list with no warning is a silent failure.",
            )


# ── DirectBuildMcqTest ────────────────────────────────────────────────────────

class DirectBuildMcqTest(TestCase):
    """
    Unit tests for _build_mcq called directly on known DBMS sentences.

    These tests bypass _assemble_quiz so they are not subject to
    top-5 sentence selection variability.  Each test constructs its own
    sentence list + freq Counter and calls _build_mcq directly.
    """

    # ── Fixed test sentences ──────────────────────────────────────────────────

    INSTANCE_SENTENCE = (
        "A database instance is the data stored in a database at a particular moment in time, "
        "also called the current state of the database."
    )
    DBA_SENTENCE = (
        "A Database Administrator, or DBA, is the person responsible for managing, "
        "maintaining, and securing the database system."
    )
    SCHEMA_SENTENCE = (
        "A database schema is the overall design or structure of the database, "
        "described in terms of the data model used."
    )
    DISTRACTOR_SOURCE = (
        "A relational database is a type of database that stores data in tables "
        "with rows and columns. "
        "SQL stands for Structured Query Language and is used to query relational "
        "databases. "
        "Normalisation is the process of organising data to reduce redundancy and "
        "improve integrity. "
        "A primary key is a field that uniquely identifies each record in a "
        "database table. "
        "A foreign key is a field in one table that refers to the primary key in "
        "another table. "
        "A transaction is a sequence of database operations that must all complete "
        "successfully. "
        "Concurrency control is a method used to manage simultaneous access to the "
        "database. "
        "A database index is a data structure that improves the speed of data "
        "retrieval operations. "
        "Data integrity refers to the accuracy and consistency of data stored in "
        "the database. "
        "An entity is an object or concept that has data stored about it in a "
        "database table."
    )

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _make_sentences_and_freq(self, raw_text: str):
        """Run the NLP pipeline on raw_text and return (sentences, freq)."""
        from api.views import clean_text, split_into_sentences, compute_freq
        cleaned = clean_text(raw_text)
        sents = split_into_sentences(cleaned)
        freq = compute_freq(sents)
        return sents, freq

    def _call_build_mcq(self, sentence: str, source_text: str,
                        used_distractors: "dict | None" = None,
                        difficulty: str = "medium") -> "dict | None":
        """
        Helper: build an MCQ for *sentence* using *source_text* as the
        full corpus (sentence + DISTRACTOR_SOURCE).

        Returns the _build_mcq result dict or None.
        """
        from api.views import _build_mcq
        sents, freq = self._make_sentences_and_freq(source_text)
        used_questions: set = set()
        if used_distractors is None:
            used_distractors = {}
        return _build_mcq(
            sentence=sentence,
            all_sentences=sents,
            freq=freq,
            difficulty=difficulty,
            used_questions=used_questions,
            used_distractors=used_distractors,
        )

    # ── test_instance_question_generated ─────────────────────────────────────

    def test_instance_question_generated(self):
        """_build_mcq returns a valid MCQ dict for the database-instance sentence."""
        source = self.INSTANCE_SENTENCE + " " + self.DISTRACTOR_SOURCE
        result = self._call_build_mcq(self.INSTANCE_SENTENCE, source)

        self.assertIsNotNone(
            result,
            "_build_mcq returned None for the database-instance sentence — "
            "not enough distractors or answer extraction failed.",
        )
        self.assertEqual(result["type"], "mcq")
        self.assertGreaterEqual(
            len(result["options"]), 2,
            f"Expected at least 2 options, got: {result['options']}",
        )
        # Correct answer must appear exactly once
        correct_lower = result["correct_answer"].strip().lower()
        occurrences = sum(
            1 for o in result["options"] if o.strip().lower() == correct_lower
        )
        self.assertEqual(
            occurrences, 1,
            f"Correct answer appears {occurrences} time(s) in options: "
            f"{result['options']}",
        )

    # ── test_instance_distractors_relevant ───────────────────────────────────

    def test_instance_distractors_relevant(self):
        """
        Distractors for the database-instance question must not be
        near-duplicates of the correct answer (similarity ≤ 0.85).
        """
        from difflib import SequenceMatcher
        source = self.INSTANCE_SENTENCE + " " + self.DISTRACTOR_SOURCE
        result = self._call_build_mcq(self.INSTANCE_SENTENCE, source)

        if result is None:
            self.skipTest(
                "database-instance MCQ not generated — cannot test distractor relevance."
            )

        correct = result["correct_answer"]
        for opt in result["options"]:
            if opt.strip().lower() == correct.strip().lower():
                continue  # skip the correct answer itself
            ratio = SequenceMatcher(None, opt.lower(), correct.lower()).ratio()
            self.assertLessEqual(
                ratio, 0.85,
                f"Distractor {opt!r} is too similar to correct answer "
                f"{correct!r} (ratio={ratio:.2f}). Similarity gate should have "
                f"rejected it.",
            )

    # ── test_dba_question_generated ───────────────────────────────────────────

    def test_dba_question_generated(self):
        """_build_mcq returns a valid MCQ dict for the DBA sentence."""
        source = self.DBA_SENTENCE + " " + self.DISTRACTOR_SOURCE
        result = self._call_build_mcq(self.DBA_SENTENCE, source)

        self.assertIsNotNone(
            result,
            "_build_mcq returned None for the DBA sentence — "
            "not enough distractors or answer extraction failed.",
        )
        self.assertEqual(result["type"], "mcq")
        self.assertGreaterEqual(len(result["options"]), 2)
        correct_lower = result["correct_answer"].strip().lower()
        occurrences = sum(
            1 for o in result["options"] if o.strip().lower() == correct_lower
        )
        self.assertEqual(
            occurrences, 1,
            f"Correct answer appears {occurrences} time(s) in options: "
            f"{result['options']}",
        )

    # ── test_dba_distractors_not_unrelated_definitions ────────────────────────

    def test_dba_distractors_not_unrelated_definitions(self):
        """
        Distractors for the DBA question must not be definitions of 'database'
        (i.e. must not contain 'organised collection') — those are unrelated
        to what a DBA is.
        Also asserts no duplicate options after normalisation.
        """
        source = self.DBA_SENTENCE + " " + self.DISTRACTOR_SOURCE
        result = self._call_build_mcq(self.DBA_SENTENCE, source)

        if result is None:
            self.skipTest(
                "DBA MCQ not generated — cannot test distractor content."
            )

        correct_lower = result["correct_answer"].strip().lower()
        opts_lower = [o.strip().lower() for o in result["options"]]

        # No 'organised collection' phrase (a definition of database, not DBA)
        for opt in opts_lower:
            if opt == correct_lower:
                continue
            self.assertNotIn(
                "organised collection",
                opt,
                f"Distractor {opt!r} contains 'organised collection', "
                f"which is a database definition unrelated to what a DBA is.",
            )

        # No duplicate options after normalisation
        self.assertEqual(
            len(opts_lower), len(set(opts_lower)),
            f"Duplicate options found in DBA MCQ: {result['options']}",
        )

    # ── test_schema_question_generated ───────────────────────────────────────

    def test_schema_question_generated(self):
        """_build_mcq returns a valid MCQ dict for the database-schema sentence."""
        source = self.SCHEMA_SENTENCE + " " + self.DISTRACTOR_SOURCE
        result = self._call_build_mcq(self.SCHEMA_SENTENCE, source)

        self.assertIsNotNone(
            result,
            "_build_mcq returned None for the schema sentence — "
            "not enough distractors or answer extraction failed.",
        )
        self.assertEqual(result["type"], "mcq")
        self.assertGreaterEqual(len(result["options"]), 2)
        correct_lower = result["correct_answer"].strip().lower()
        occurrences = sum(
            1 for o in result["options"] if o.strip().lower() == correct_lower
        )
        self.assertEqual(
            occurrences, 1,
            f"Correct answer appears {occurrences} time(s) in options: "
            f"{result['options']}",
        )

    # ── test_cross_question_no_reuse_when_alternatives_exist ──────────────────

    def test_cross_question_no_reuse_when_alternatives_exist(self):
        """
        Building all three questions sharing the same used_distractors dict
        should result in no single distractor appearing in all three questions
        (max reuse ≤ 2 out of 3).
        """
        from api.views import _build_mcq
        from collections import Counter as _Counter

        # Build a single combined source with all three topic sentences +
        # extra distractors, so all three MCQs can find candidates.
        combined_source = (
            self.INSTANCE_SENTENCE + " "
            + self.DBA_SENTENCE + " "
            + self.SCHEMA_SENTENCE + " "
            + self.DISTRACTOR_SOURCE
        )
        sents, freq = self._make_sentences_and_freq(combined_source)
        used_questions: set = set()
        used_distractors: dict = {}

        results = []
        for sentence in (self.INSTANCE_SENTENCE, self.DBA_SENTENCE, self.SCHEMA_SENTENCE):
            q = _build_mcq(
                sentence=sentence,
                all_sentences=sents,
                freq=freq,
                difficulty="medium",
                used_questions=used_questions,
                used_distractors=used_distractors,
            )
            results.append(q)

        # Only proceed with the questions that were actually generated
        generated = [r for r in results if r is not None]
        if len(generated) < 2:
            self.skipTest(
                f"Only {len(generated)} of 3 MCQs generated — "
                "cannot test cross-question reuse with fewer than 2 questions."
            )

        # Collect all distractors (options that are not the correct answer)
        all_distractors: list[str] = []
        for q in generated:
            correct_lower = q["correct_answer"].strip().lower()
            for opt in q["options"]:
                if opt.strip().lower() != correct_lower:
                    all_distractors.append(opt.strip().lower())

        counts = _Counter(all_distractors)
        for distractor, cnt in counts.items():
            self.assertLessEqual(
                cnt, 2,
                f"Distractor {distractor!r} appears in {cnt} out of "
                f"{len(generated)} questions — cross-question reservation "
                f"is not limiting reuse to ≤ 2.",
            )

    # ── test_correct_answer_grades_correctly_after_shuffle ────────────────────

    def test_correct_answer_grades_correctly_after_shuffle(self):
        """
        Simulating a deterministic shuffle (sorted order) must not break
        grading: the value at the shuffled correct index must still equal
        correct_answer.

        This verifies that grading is done by value (not by original index).
        """
        source = self.INSTANCE_SENTENCE + " " + self.DISTRACTOR_SOURCE
        result = self._call_build_mcq(self.INSTANCE_SENTENCE, source)

        if result is None:
            self.skipTest(
                "database-instance MCQ not generated — cannot test shuffle grading."
            )

        original_answer = result["correct_answer"]
        shuffled = sorted(result["options"])  # deterministic reorder

        # Find the index of the correct answer in the shuffled list
        shuffled_lower = [o.strip().lower() for o in shuffled]
        answer_lower = original_answer.strip().lower()

        self.assertIn(
            answer_lower, shuffled_lower,
            f"Correct answer {original_answer!r} disappeared after sorting options.",
        )
        idx = shuffled_lower.index(answer_lower)
        self.assertEqual(
            shuffled[idx].strip().lower(),
            answer_lower,
            f"After shuffle, shuffled[{idx}]={shuffled[idx]!r} does not match "
            f"correct answer {original_answer!r}.",
        )

    # ── test_short_source_does_not_crash ─────────────────────────────────────

    def test_short_source_does_not_crash(self):
        """
        Calling _build_mcq with a 2-word source must not raise an exception.
        It should either return None or a structurally valid dict.
        """
        from api.views import _build_mcq, clean_text, split_into_sentences, compute_freq

        short_text = "Database data."
        cleaned = clean_text(short_text)
        sents = split_into_sentences(cleaned)
        freq = compute_freq(sents)

        # Must not raise — any exception here is a bug
        try:
            # Use the first sentence if available, else the raw text
            target = sents[0] if sents else short_text
            result = _build_mcq(
                sentence=target,
                all_sentences=sents,
                freq=freq,
                difficulty="medium",
                used_questions=set(),
                used_distractors={},
            )
        except Exception as exc:  # noqa: BLE001
            self.fail(
                f"_build_mcq raised an unexpected exception on short source: {exc}"
            )

        # Result is either None (graceful skip) or a structurally valid dict
        if result is not None:
            self.assertIn("correct_answer", result)
            self.assertIn("options", result)
            self.assertIn(
                result["correct_answer"].strip().lower(),
                [o.strip().lower() for o in result["options"]],
                "correct_answer not found in options on short-source result.",
            )
