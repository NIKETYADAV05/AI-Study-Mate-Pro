from django.urls import path
from . import views

urlpatterns = [
    path("health/",              views.health,                name="health"),
    path("summarize/",           views.summarize,             name="summarize"),
    path("quiz/",                views.generate_quiz,         name="generate_quiz"),
    path("notes/",               views.notes_list,            name="notes_list"),
    path("notes/<int:pk>/",      views.note_detail,           name="note_detail"),
    path("tasks/",               views.tasks_list,            name="tasks_list"),
    path("tasks/<int:pk>/",      views.task_detail,           name="task_detail"),
    path("quiz-attempts/",       views.quiz_attempts,         name="quiz_attempts"),
    path("progress/",            views.progress_stats,        name="progress_stats"),
    path("revision-plan/",       views.create_revision_plan,  name="create_revision_plan"),
    path("quests/",              views.quests_today,          name="quests_today"),
    path("quests/claim/",        views.claim_quest,           name="claim_quest"),
    path("nova-check/",          views.nova_check,            name="nova_check"),
    path("chat/",                views.chat,                  name="chat"),
    path("profile/",             views.student_profile_view,  name="student_profile"),
    path("profile/reset/",       views.reset_profile_defaults,name="reset_profile_defaults"),
    path("profile/reset-history/", views.reset_study_history, name="reset_study_history"),
]

