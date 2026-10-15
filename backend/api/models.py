from django.db import models


class QuizAttempt(models.Model):
    """
    Records a single completed quiz attempt.

    Score validation note: the Django quiz endpoint generates questions
    ephemerally (not stored). We therefore cannot independently re-derive
    correct answers on the server. Instead we validate that:
      - 0 ≤ score ≤ total_questions
      - percentage == round(score / total * 100)  (recalculated server-side)
    Client-supplied percentages are IGNORED; the server always recalculates.
    """

    DIFFICULTY_CHOICES = [
        ("easy",   "Easy"),
        ("medium", "Medium"),
        ("hard",   "Hard"),
    ]
    QUIZ_TYPE_CHOICES = [
        ("mcq",       "Multiple Choice"),
        ("truefalse", "True / False"),
        ("mixed",     "Mixed"),
    ]
    SUBJECT_CHOICES = [
        ("Computer Networks",  "Computer Networks"),
        ("Operating Systems",  "Operating Systems"),
        ("DBMS",               "DBMS"),
        ("Java",               "Java"),
        ("Web Development",    "Web Development"),
        ("Mathematics",        "Mathematics"),
        ("Physics",            "Physics"),
        ("Chemistry",          "Chemistry"),
        ("Biology",            "Biology"),
        ("History",            "History"),
        ("Other",              "Other"),
        ("Unknown",            "Unknown"),   # when no subject tag was set
    ]

    score           = models.PositiveSmallIntegerField()
    total_questions = models.PositiveSmallIntegerField()
    # percentage is stored for fast reads but ALWAYS recalculated on write
    percentage      = models.PositiveSmallIntegerField()
    difficulty      = models.CharField(max_length=10, choices=DIFFICULTY_CHOICES, default="medium")
    quiz_type       = models.CharField(max_length=20, choices=QUIZ_TYPE_CHOICES, default="mixed")
    subject         = models.CharField(max_length=50, choices=SUBJECT_CHOICES, default="Unknown")
    taken_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-taken_at"]

    def __str__(self):
        return f"{self.score}/{self.total_questions} ({self.percentage}%) — {self.difficulty} {self.quiz_type} @ {self.taken_at:%Y-%m-%d %H:%M}"


class StudyTask(models.Model):
    """A single study task in the planner."""

    SUBJECT_CHOICES = [
        ("Computer Networks",  "Computer Networks"),
        ("Operating Systems",  "Operating Systems"),
        ("DBMS",               "DBMS"),
        ("Java",               "Java"),
        ("Web Development",    "Web Development"),
        ("Mathematics",        "Mathematics"),
        ("Physics",            "Physics"),
        ("Chemistry",          "Chemistry"),
        ("Biology",            "Biology"),
        ("History",            "History"),
        ("Other",              "Other"),
    ]

    PRIORITY_CHOICES = [
        ("low",    "Low"),
        ("medium", "Medium"),
        ("high",   "High"),
    ]

    title       = models.CharField(max_length=200)
    subject     = models.CharField(max_length=50, choices=SUBJECT_CHOICES, default="Other")
    description = models.TextField(blank=True, default="")
    due_date    = models.DateField()
    priority    = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default="medium")
    duration    = models.PositiveIntegerField(
        default=30,
        help_text="Estimated study duration in minutes",
    )
    completed   = models.BooleanField(default=False)
    created     = models.DateTimeField(auto_now_add=True)
    updated     = models.DateTimeField(auto_now=True)

    # ── Time-Travel Revision ──────────────────────────────────────────────────
    # Nullable FK to the Note this task was generated from.
    # SET_NULL: if the note is deleted, the revision task is preserved with
    # note set to NULL rather than being cascade-deleted.
    # revision_day: which spaced-repetition day this task represents (1/3/7/14).
    # Together, (note, revision_day) form the natural key for dedup — they are
    # set once at creation and never changed by normal user edits, so they are
    # reliable even if the user renames or edits the task title.
    note         = models.ForeignKey(
        "Note",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="revision_tasks",
        help_text="The note this revision task was generated from, if any.",
    )
    revision_day = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Spaced-repetition day offset (1, 3, 7, or 14). NULL for non-revision tasks.",
    )

    class Meta:
        ordering = ["due_date", "-created"]

    def __str__(self):
        status = "✓" if self.completed else "○"
        return f"[{status}] {self.title} ({self.subject}) — due {self.due_date}"


class Note(models.Model):
    """A single saved study note."""

    SUBJECT_CHOICES = [
        ("Computer Networks",  "Computer Networks"),
        ("Operating Systems",  "Operating Systems"),
        ("DBMS",               "DBMS"),
        ("Java",               "Java"),
        ("Web Development",    "Web Development"),
        ("Mathematics",        "Mathematics"),
        ("Physics",            "Physics"),
        ("Chemistry",          "Chemistry"),
        ("Biology",            "Biology"),
        ("History",            "History"),
        ("Other",              "Other"),
    ]

    title   = models.CharField(max_length=200)
    subject = models.CharField(max_length=50, choices=SUBJECT_CHOICES, default="Other")
    content = models.TextField()
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated"]

    def __str__(self):
        return f"{self.title} ({self.subject})"


class DailyQuestLog(models.Model):
    """
    Records each successfully completed daily quest claim.

    Each row represents one user earning XP for one quest on one calendar day.
    The (quest_key, quest_date) unique_together constraint is the database-level
    lock that makes double-claiming impossible — even under concurrent requests
    the second INSERT raises IntegrityError which the view catches and returns
    409.

    quest_key format (stable, never changes for the same logical quest):
      "revision:<task_pk>"       — Revision Quest linked to a StudyTask
      "knowledge:<note_pk>"      — Knowledge Quest linked to a Note
      "battle:<date_iso>"        — Battle Quest for a calendar day
      "growth:<subject>:<date>"  — Growth Quest for a subject on a day

    Historical XP is preserved even if the linked task or note is later
    deleted, because we store the awarded value directly on this row rather
    than referencing the source object.
    """

    quest_key    = models.CharField(max_length=150)
    quest_date   = models.DateField()      # Asia/Kolkata local date
    quest_type   = models.CharField(max_length=20)   # revision|knowledge|battle|growth
    xp_awarded   = models.PositiveSmallIntegerField()
    completed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("quest_key", "quest_date")]
        ordering = ["-completed_at"]

    def __str__(self):
        return f"{self.quest_key} on {self.quest_date} (+{self.xp_awarded} XP)"


class StudentProfile(models.Model):
    """
    Persists student profile information and study preferences.
    Local single-user architecture.
    """

    display_name = models.CharField(max_length=100, default="Niket")
    college = models.CharField(max_length=200, blank=True, default="")
    course = models.CharField(max_length=150, blank=True, default="Computer Science & Engineering")
    semester = models.CharField(max_length=50, blank=True, default="Semester 6")
    bio = models.TextField(blank=True, default="Passionate student focused on mastery and continuous learning.")

    # Study preferences
    preferred_subjects = models.JSONField(default=list, blank=True)
    daily_study_goal_minutes = models.PositiveIntegerField(default=60)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.display_name} ({self.course})"

