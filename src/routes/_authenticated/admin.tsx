import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { adminOverview, verifyAuditChain, setUserRole } from "@/lib/vault.functions";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — TrustVault" }, { name: "description", content: "Audit activity and access control." }] }),
  component: Admin,
});

const ACTIONS = ["", "upload", "download", "modify", "delete", "permission_granted", "permission_revoked", "access_denied", "upload_rejected", "role_changed"];

function Admin() {
  const { data: me } = useMe();
  const [action, setAction] = useState("");
  const [deniedOnly, setDeniedOnly] = useState(false);
  const overview = useServerFn(adminOverview);
  const verify = useServerFn(verifyAuditChain);
  const setRole = useServerFn(setUserRole);
  const qc = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["admin", action, deniedOnly],
    queryFn: () => overview({ data: { action: action || undefined, deniedOnly } }),
    retry: false,
  });
  const [chain, setChain] = useState<{ valid: boolean; checked: number; broken_at: number | null } | null>(null);

  if (error) return <div className="text-sm text-destructive">You need the admin role to view this page.</div>;
  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;

  async function toggleRole(userId: string, role: "admin" | "owner" | "viewer", enabled: boolean) {
    try { await setRole({ data: { userId, role, enabled } }); qc.invalidateQueries({ queryKey: ["admin"] }); }
    catch (e: any) { toast.error(e.message); }
  }

  const stats = [
    ["Documents", data.stats.documents], ["Active shares", data.stats.permissions], ["Users", data.stats.users], ["Denied attempts", data.stats.denied],
  ] as const;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Admin dashboard</h1>
          <p className="text-sm text-muted-foreground">Document activity, permission changes and audit integrity.</p>
        </div>
        <div className="flex items-center gap-3">
          {chain && (
            <Badge variant={chain.valid ? "success" : "danger"} className="gap-1 py-1">
              {chain.valid ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
              {chain.valid ? `Chain intact · ${chain.checked} entries` : `Tampering detected at #${chain.broken_at}`}
            </Badge>
          )}
          <Button variant="outline" onClick={async () => { try { setChain(await verify()); } catch (e: any) { toast.error(e.message); } }}>
            Verify audit chain
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        {stats.map(([label, n]) => (
          <div key={label} className="rounded-lg border bg-card p-5 shadow-card">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="mt-2 font-display text-3xl font-semibold">{n}</div>
          </div>
        ))}
      </div>

      <section className="rounded-lg border bg-card shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <h2 className="font-semibold">Audit log</h2>
          <div className="flex items-center gap-3 text-sm">
            <select className="rounded-md border bg-background px-2 py-1.5" value={action} onChange={(e) => setAction(e.target.value)}>
              {ACTIONS.map((a) => <option key={a} value={a}>{a || "All actions"}</option>)}
            </select>
            <label className="flex items-center gap-2"><Switch checked={deniedOnly} onCheckedChange={setDeniedOnly} /> Failures only</label>
          </div>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-2">#</th><th className="px-4 py-2">Time</th><th className="px-4 py-2">Actor</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">Document</th><th className="px-4 py-2">Details</th><th className="px-4 py-2">Hash</th></tr>
            </thead>
            <tbody>
              {data.logs.map((l: any) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{l.id}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2">{l.actor_email}</td>
                  <td className="px-4 py-2"><Badge variant={l.success ? "outline" : "danger"} className="font-mono">{l.action}</Badge></td>
                  <td className="px-4 py-2">{l.document_title ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{Object.keys(l.details ?? {}).length ? JSON.stringify(l.details) : ""}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground" title={l.hash}>{l.hash.slice(0, 10)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-card shadow-card">
        <h2 className="border-b p-4 font-semibold">Users & roles</h2>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-4 py-2">User</th><th className="px-4 py-2">Admin</th><th className="px-4 py-2">Owner (can upload)</th><th className="px-4 py-2">Viewer</th></tr>
          </thead>
          <tbody>
            {data.users.map((u: any) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="px-4 py-2"><div>{u.display_name}</div><div className="text-xs text-muted-foreground">{u.email}</div></td>
                {(["admin", "owner", "viewer"] as const).map((r) => (
                  <td key={r} className="px-4 py-2">
                    <Switch checked={u.roles.includes(r)} disabled={r === "admin" && u.id === me?.userId}
                      onCheckedChange={(v) => toggleRole(u.id, r, v)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
