"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import {
  House,
  LayoutDashboard,
  CalendarDays,
  BookOpen,
  ClipboardList,
  Files,
  BrainCircuit,
  ChartNoAxesCombined,
  GraduationCap,
  FolderKanban,
  BriefcaseBusiness,
  Settings,
  Menu,
  X,
} from "lucide-react";

const navigation = [
  {
    name: "Main Dashboard",
    href: "/dashboard",
    icon: House,
  },
  {
    name: "Academic Overview",
    href: "/student",
    icon: LayoutDashboard,
  },
  {
    name: "Study Planner",
    href: "/student/planner",
    icon: CalendarDays,
  },
  {
    name: "Subjects",
    href: "/student/subjects",
    icon: BookOpen,
  },
  {
    name: "Assignments",
    href: "/student/assignments",
    icon: ClipboardList,
  },
  {
    name: "Notes & Documents",
    href: "/student/notes",
    icon: Files,
  },
  {
    name: "AI Tutor",
    href: "/student/ai-tutor",
    icon: BrainCircuit,
  },
  {
    name: "AI Student Progress Tracker",
    href: "/student/progress",
    icon: ChartNoAxesCombined,
  },
  {
    name: "Exam Preparation",
    href: "/student/exams",
    icon: GraduationCap,
  },
  {
    name: "Projects",
    href: "/student/projects",
    icon: FolderKanban,
  },
  {
    name: "Placement Preparation",
    href: "/student/placement",
    icon: BriefcaseBusiness,
  },
  {
    name: "Settings",
    href: "/student/settings",
    icon: Settings,
  },
];

export default function StudentSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between border-b bg-white px-4 lg:hidden">
        <span className="font-semibold text-slate-900">
          Student Workspace
        </span>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label="Toggle navigation"
          aria-expanded={open}
          className="rounded-lg border p-2 text-slate-700"
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-950 text-white transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
      >
        <div className="flex items-start justify-between border-b border-slate-800 px-5 py-5">
          <div>
            <h1 className="text-lg font-bold">
              Multi-Agent AI
            </h1>

            <p className="mt-1 text-xs uppercase tracking-wider text-indigo-400">
              Student Workspace
            </p>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="text-slate-400 hover:text-white lg:hidden"
          >
            <X size={22} />
          </button>
        </div>

        <nav
          aria-label="Student navigation"
          className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3"
          style={{
            scrollbarWidth: "thin",
            scrollbarColor: "#334155 transparent",
          }}
        >
          {navigation.map((item) => {
            const active =
              item.href === "/student"
                ? pathname === item.href
                : pathname === item.href ||
                  pathname.startsWith(item.href + "/");

            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-indigo-600 text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <Icon
                  size={19}
                  strokeWidth={1.8}
                  className="shrink-0"
                  aria-hidden="true"
                />

                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 px-5 py-4">
          <p className="text-xs text-slate-400">
            Multi-Agent AI Platform
          </p>

          <p className="mt-1 text-xs text-slate-500">
            Student Mode
          </p>
        </div>
      </aside>
    </>
  );
}