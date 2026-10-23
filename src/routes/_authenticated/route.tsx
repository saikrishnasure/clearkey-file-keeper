import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, FolderLock, LayoutDashboard, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-me";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: Layout,
});


function Layout() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isAdmin = me?.roles.includes("admin");

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const link = "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent";
  const active = { className: "bg-sidebar-accent text-sidebar-accent-foreground" };

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground">
        <Link to="/vault" className="mb-8 flex items-center gap-2 px-2 font-display text-lg font-semibold">
          <ShieldCheck className="h-5 w-5 text-sidebar-primary" /> TrustVault
        </Link>
        <nav className="space-y-1">
          <Link to="/vault" className={link} activeProps={active}>
            <FolderLock className="h-4 w-4" /> Documents
          </Link>
          {isAdmin && (
            <Link to="/admin" className={link} activeProps={active}>
              <LayoutDashboard className="h-4 w-4" /> Admin
            </Link>
          )}
        </nav>
        <div className="mt-auto border-t border-sidebar-border pt-4">
          <div className="px-2 text-sm font-medium">{me?.profile?.display_name ?? "…"}</div>
          <div className="truncate px-2 text-xs text-sidebar-foreground/60">{me?.profile?.email}</div>
          <div className="mt-2 flex flex-wrap gap-1 px-2">
            {me?.roles.map((r) => (
              <span key={r} className="rounded bg-sidebar-accent px-1.5 py-0.5 font-mono text-[10px] uppercase text-sidebar-primary">
                {r}
              </span>
            ))}
          </div>
          <button onClick={signOut} className={`${link} mt-3 w-full`}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
