import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import StudentSidebar from "./student-sidebar";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <StudentSidebar />

      <div className="min-h-screen pt-16 lg:ml-64 lg:pt-0">
        {children}
      </div>
    </div>
  );
}