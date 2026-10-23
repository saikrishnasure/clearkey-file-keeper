import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, KeyRound, ScrollText, Lock, FileCheck2, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TrustVault — Secure document sharing with audit trails" },
      { name: "description", content: "Store, share and control confidential documents with role-based access, per-document permissions and tamper-evident audit logs." },
      { property: "og:title", content: "TrustVault — Secure document sharing" },
      { property: "og:description", content: "Role-based access, per-document permissions and tamper-evident audit logging." },
    ],
  }),
  component: Index,
});

const features = [
  { icon: KeyRound, title: "Least-privilege access", text: "Grant read or edit per document, per person. Revoke instantly — the next request is refused." },
  { icon: Lock, title: "Server-enforced", text: "Every view, download, edit and delete is authorized on the server. Files live in private storage." },
  { icon: ScrollText, title: "Tamper-evident log", text: "Each audit entry is hash-chained to the last. Any alteration breaks the chain and is detected." },
  { icon: FileCheck2, title: "File validation", text: "Type, extension and file signature are checked; every file is fingerprinted with SHA-256." },
  { icon: UserX, title: "Denied attempts recorded", text: "Unauthorized access attempts are logged with who, what and when." },
  { icon: ShieldCheck, title: "Admin oversight", text: "A dashboard for activity, permission changes, roles and chain integrity." },
];

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <section className="bg-vault text-sidebar-foreground">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <div className="flex items-center gap-2 font-display text-lg font-semibold">
            <ShieldCheck className="h-6 w-6 text-sidebar-primary" /> TrustVault
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link to="/auth">Sign in</Link>
          </Button>
        </header>
        <div className="mx-auto max-w-6xl px-6 pb-28 pt-16">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-sidebar-primary">Confidential by default</p>
          <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[1.05] md:text-6xl">
            Share documents. <br />Keep control of every byte.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-sidebar-foreground/75">
            TrustVault protects confidential files with role-based sign-in, document-level permissions and an audit trail nobody can quietly rewrite.
          </p>
          <div className="mt-10 flex gap-3">
            <Button asChild size="lg" className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90">
              <Link to="/auth">Open your vault</Link>
            </Button>
          </div>
          <div className="mt-16 rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-4 font-mono text-xs text-sidebar-foreground/70">
            <div>#1042 · permission_revoked · a3f9…c21e ← 7be0…91d4</div>
            <div>#1043 · access_denied · <span className="text-destructive">denied</span> · 0c4e…aa17 ← a3f9…c21e</div>
            <div>#1044 · download · 5d12…e8b0 ← 0c4e…aa17</div>
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-6 px-6 py-20 md:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-lg border bg-card p-6 shadow-card">
            <f.icon className="h-6 w-6 text-primary" />
            <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
          </div>
        ))}
      </section>
      <footer className="border-t py-8 text-center text-xs text-muted-foreground">TrustVault · secure document sharing</footer>
    </div>
  );
}
