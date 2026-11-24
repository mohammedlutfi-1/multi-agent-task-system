"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

import {
  BookOpen,
  ClipboardList,
  ChartNoAxesCombined,
  GraduationCap,
  CalendarDays,
  Clock,
  FolderKanban,
  BrainCircuit,
  ArrowRight,
  Settings,
} from "lucide-react";

type StudentProfile = {
  college_name: string | null;
  course: string | null;
  semester: number | null;
};

type DashboardItem = {
  id: string;
  title: string;
  status?: string;
};

type DashboardData = {
  profile: StudentProfile | null;
  subjects: number;
  assignments: number;
  attendance: number | null;
  exams: number;
  studyPlans: DashboardItem[];
  deadlines: DashboardItem[];
  projects: DashboardItem[];
  upcomingExams: DashboardItem[];
};

const initialData: DashboardData = {
  profile: null,
  subjects: 0,
  assignments: 0,
  attendance: null,
  exams: 0,
  studyPlans: [],
  deadlines: [],
  projects: [],
  upcomingExams: [],
};

export default function StudentPage() {
  const [data, setData] =
    useState<DashboardData>(initialData);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadDashboard() {
      try {
        const supabase = createClient();

        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
          window.location.replace("/");
          return;
        }

        const userId = user.id;
        const now = new Date();

        const today = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0"),
        ].join("-");

        const [
          profile,
          subjects,
          assignments,
          attendance,
          exams,
          studyPlans,
          deadlines,
          projects,
          upcomingExams,
        ] = await Promise.all([
          supabase
            .from("student_profiles")
            .select("college_name, course, semester")
            .eq("user_id", userId)
            .maybeSingle(),

          supabase
            .from("student_subjects")
            .select("id", {
              count: "exact",
              head: true,
            })
            .eq("user_id", userId),

          supabase
            .from("student_assignments")
            .select("id", {
              count: "exact",
              head: true,
            })
            .eq("user_id", userId)
            .in("status", ["pending", "in_progress"]),

          supabase
            .from("student_attendance")
            .select("total_classes, attended_classes")
            .eq("user_id", userId),

          supabase
            .from("student_exams")
            .select("id", {
              count: "exact",
              head: true,
            })
            .eq("user_id", userId)
            .eq("status", "upcoming")
            .gte("exam_date", today),

          supabase
            .from("student_study_plans")
            .select("id, title, status")
            .eq("user_id", userId)
            .eq("study_date", today)
            .order("start_time")
            .limit(5),

          supabase
            .from("student_assignments")
            .select("id, title, status")
            .eq("user_id", userId)
            .in("status", ["pending", "in_progress"])
            .gte("due_date", now.toISOString())
            .order("due_date")
            .limit(5),

          supabase
            .from("student_projects")
            .select("id, title, status")
            .eq("user_id", userId)
            .in("status", ["planning", "in_progress"])
            .order("created_at", { ascending: false })
            .limit(5),

          supabase
            .from("student_exams")
            .select("id, title, status")
            .eq("user_id", userId)
            .eq("status", "upcoming")
            .gte("exam_date", today)
            .order("exam_date")
            .limit(5),
        ]);

        const results = [
          profile,
          subjects,
          assignments,
          attendance,
          exams,
          studyPlans,
          deadlines,
          projects,
          upcomingExams,
        ];

        const failed = results.find(
          (result) => result.error
        );

        if (failed?.error) {
          throw new Error(failed.error.message);
        }

        const attendanceRows = attendance.data ?? [];

        const totalClasses = attendanceRows.reduce(
          (sum, row) => sum + row.total_classes,
          0
        );

        const attendedClasses = attendanceRows.reduce(
          (sum, row) => sum + row.attended_classes,
          0
        );

        const attendancePercentage =
          totalClasses > 0
            ? Math.round(
                (attendedClasses / totalClasses) * 1000
              ) / 10
            : null;

        setData({
          profile: profile.data,
          subjects: subjects.count ?? 0,
          assignments: assignments.count ?? 0,
          attendance: attendancePercentage,
          exams: exams.count ?? 0,
          studyPlans: studyPlans.data ?? [],
          deadlines: deadlines.data ?? [],
          projects: projects.data ?? [],
          upcomingExams: upcomingExams.data ?? [],
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load academic dashboard."
        );
      } finally {
        setLoading(false);
      }
    }

    void loadDashboard();
  }, []);

  const statistics = [
    {
      title: "Total Subjects",
      value: data.subjects,
      icon: BookOpen,
      color: "text-indigo-600 bg-indigo-50",
      href: "/student/subjects",
    },
    {
      title: "Pending Assignments",
      value: data.assignments,
      icon: ClipboardList,
      color: "text-orange-600 bg-orange-50",
      href: "/student/assignments",
    },
    {
      title: "Overall Attendance",
      value:
        data.attendance === null
          ? "—"
          : `${data.attendance}%`,
      icon: ChartNoAxesCombined,
      color: "text-emerald-600 bg-emerald-50",
      href: "/student/attendance",
    },
    {
      title: "Upcoming Exams",
      value: data.exams,
      icon: GraduationCap,
      color: "text-purple-600 bg-purple-50",
      href: "/student/exams",
    },
  ];

  const sections = [
    {
      title: "Today's Study Plan",
      icon: CalendarDays,
      items: data.studyPlans,
      empty: "No study sessions scheduled today.",
      href: "/student/planner",
    },
    {
      title: "Upcoming Deadlines",
      icon: Clock,
      items: data.deadlines,
      empty: "No upcoming assignment deadlines.",
      href: "/student/assignments",
    },
    {
      title: "Active Projects",
      icon: FolderKanban,
      items: data.projects,
      empty: "No active projects.",
      href: "/student/projects",
    },
    {
      title: "Upcoming Exams",
      icon: GraduationCap,
      items: data.upcomingExams,
      empty: "No upcoming exams scheduled.",
      href: "/student/exams",
    },
  ];

  const quickActions = [
    {
      title: "Manage Subjects",
      icon: BookOpen,
      href: "/student/subjects",
    },
    {
      title: "Open Study Planner",
      icon: CalendarDays,
      href: "/student/planner",
    },
    {
      title: "Manage Assignments",
      icon: ClipboardList,
      href: "/student/assignments",
    },
    {
      title: "Ask AI Tutor",
      icon: BrainCircuit,
      href: "/student/ai-tutor",
    },
  ];

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" />

          <p className="text-sm text-slate-500">
            Loading your academic dashboard...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <main className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">
          <h2 className="font-semibold">
            Unable to load dashboard
          </h2>

          <p className="mt-2 text-sm">{error}</p>

          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm text-white"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6 xl:p-8">
      <div className="mx-auto max-w-7xl space-y-6">

        {/* Page heading */}

        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Academic Overview
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Manage your studies, assignments and
            academic progress.
          </p>
        </div>

        {/* Welcome banner */}

        <section className="rounded-2xl bg-gradient-to-r from-indigo-700 to-violet-600 p-6 text-white sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div>
              <h2 className="text-2xl font-bold">
                Welcome to your Student Workspace
              </h2>

              {data.profile ? (
                <>
                  <p className="mt-3 text-indigo-100">
                    {data.profile.course ||
                      "Course not configured"}

                    {data.profile.semester
                      ? ` · Semester ${data.profile.semester}`
                      : ""}
                  </p>

                  <p className="mt-1 text-sm text-indigo-200">
                    {data.profile.college_name ||
                      "College not configured"}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-indigo-100">
                  Complete your academic profile to
                  personalize your workspace.
                </p>
              )}
            </div>

            <Link
              href="/student/settings"
              className="flex items-center gap-2 rounded-lg bg-white/15 px-4 py-3 text-sm font-medium hover:bg-white/25"
            >
              <Settings size={17} />
              Edit Profile
            </Link>
          </div>
        </section>

        {/* Statistics */}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {statistics.map((stat) => {
            const Icon = stat.icon;

            return (
              <Link
                key={stat.title}
                href={stat.href}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-500">
                    {stat.title}
                  </span>

                  <div className={`rounded-lg p-2.5 ${stat.color}`}>
                    <Icon size={21} />
                  </div>
                </div>

                <p className="mt-4 text-3xl font-bold text-slate-900">
                  {stat.value}
                </p>
              </Link>
            );
          })}
        </section>

        {/* Academic activity */}

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {sections.map((section) => {
            const Icon = section.icon;

            return (
              <div
                key={section.title}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Icon
                      size={21}
                      className="text-indigo-600"
                    />

                    <h2 className="font-semibold text-slate-900">
                      {section.title}
                    </h2>
                  </div>

                  <Link
                    href={section.href}
                    className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
                  >
                    View all
                    <ArrowRight size={14} />
                  </Link>
                </div>

                <div className="mt-5 border-t border-slate-100 pt-4">
                  {section.items.length === 0 ? (
                    <div className="flex min-h-28 flex-col items-center justify-center gap-3">
                      <Icon
                        size={30}
                        className="text-slate-300"
                      />

                      <p className="text-center text-sm text-slate-500">
                        {section.empty}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {section.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3"
                        >
                          <p className="text-sm font-medium text-slate-700">
                            {item.title}
                          </p>

                          <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs capitalize text-indigo-700">
                            {item.status?.replaceAll(
                              "_",
                              " "
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* Quick actions */}

        <section>
          <h2 className="mb-4 text-lg font-semibold text-slate-900">
            Quick Actions
          </h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {quickActions.map((action) => {
              const Icon = action.icon;

              return (
                <Link
                  key={action.title}
                  href={action.href}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm font-medium text-slate-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50"
                >
                  <Icon
                    size={21}
                    className="shrink-0 text-indigo-600"
                  />

                  <span>{action.title}</span>
                </Link>
              );
            })}
          </div>
        </section>

        <footer className="pb-2 text-center text-xs text-slate-400">
          Multi-Agent AI Platform · Student Workspace
        </footer>
      </div>
    </main>
  );
}
