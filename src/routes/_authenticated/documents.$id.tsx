import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, Trash2, UserPlus, X, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  getDocument, downloadDocument, updateDocument, deleteDocument, grantPermission, revokePermission,
} from "@/lib/vault.functions";
import { fileToBase64, formatBytes, ACCEPT, guessMime } from "@/lib/file-reader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/documents/$id")({
  head: () => ({ meta: [{ title: "Document — TrustVault" }, { name: "description", content: "Document details and sharing." }] }),
  component: DocPage,
});

function DocPage() {
  const { id } = Route.useParams();
  const get = useServerFn(getDocument);
  const { data, error, isLoading } = useQuery({ queryKey: ["doc", id], queryFn: () => get({ data: { id } }), retry: false });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (error || !data)
    return (
      <div className="mx-auto mt-20 max-w-md rounded-lg border bg-card p-8 text-center shadow-card">
        <ShieldAlert className="mx-auto h-10 w-10 text-destructive" />
        <h1 className="mt-4 text-xl font-semibold">Access denied</h1>
        <p className="mt-2 text-sm text-muted-foreground">You don't have permission to view this document. This attempt has been recorded.</p>
        <Button asChild variant="outline" className="mt-6"><Link to="/vault">Back to documents</Link></Button>
      </div>
    );

  return <DocDetail data={data} />;
}

function DocDetail({ data }: { data: any }) {
  const { doc, owner, isOwner, canEdit, permissions, activity } = data;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const download = useServerFn(downloadDocument);
  const del = useServerFn(deleteDocument);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["doc", doc.id] });
    qc.invalidateQueries({ queryKey: ["docs"] });
  };

  async function onDownload() {
    try {
      const { url } = await download({ data: { id: doc.id } });
      window.location.href = url;
      refresh();
    } catch (e: any) {
      toast.error(e.message);
      refresh();
    }
  }

  async function onDelete() {
    try {
      await del({ data: { id: doc.id } });
      toast.success("Document deleted");
      qc.invalidateQueries({ queryKey: ["docs"] });
      navigate({ to: "/vault" });
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/vault" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Documents
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">{doc.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {doc.folder} · owned by {isOwner ? "you" : owner?.email} · v{doc.version}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onDownload}><Download className="mr-2 h-4 w-4" /> Download</Button>
          {isOwner && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline"><Trash2 className="h-4 w-4" /></Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this document?</AlertDialogTitle>
                  <AlertDialogDescription>The file and all its versions will be permanently removed. The deletion is recorded in the audit log.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-lg border bg-card p-6 shadow-card">
            <h2 className="font-semibold">Details</h2>
            {doc.description && <p className="mt-2 text-sm">{doc.description}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted-foreground">File</dt><dd>{doc.file_name}</dd></div>
              <div><dt className="text-muted-foreground">Size</dt><dd>{formatBytes(doc.size_bytes)}</dd></div>
              <div><dt className="text-muted-foreground">Type</dt><dd className="truncate">{doc.mime_type}</dd></div>
              <div><dt className="text-muted-foreground">Updated</dt><dd>{new Date(doc.updated_at).toLocaleString()}</dd></div>
              <div className="col-span-2"><dt className="text-muted-foreground">SHA-256</dt><dd className="break-all font-mono text-xs">{doc.sha256}</dd></div>
            </dl>
            <div className="mt-3 flex gap-1">{doc.tags.map((t: string) => <Badge key={t} variant="secondary">{t}</Badge>)}</div>
          </section>
          {canEdit && <EditForm doc={doc} onDone={refresh} />}
          {isOwner && (
            <section className="rounded-lg border bg-card p-6 shadow-card">
              <h2 className="font-semibold">Activity on this document</h2>
              <ul className="mt-3 divide-y text-sm">
                {activity.map((a: any) => (
                  <li key={a.id} className="flex items-center justify-between py-2">
                    <span>
                      <Badge variant={a.success ? "outline" : "danger"} className="mr-2 font-mono">{a.action}</Badge>
                      {a.actor_email}
                    </span>
                    <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        {isOwner && <SharePanel docId={doc.id} permissions={permissions} onDone={refresh} />}
      </div>
    </div>
  );
}

function EditForm({ doc, onDone }: { doc: any; onDone: () => void }) {
  const update = useServerFn(updateDocument);
  const [title, setTitle] = useState(doc.title);
  const [description, setDescription] = useState(doc.description);
  const [folder, setFolder] = useState(doc.folder);
  const [tags, setTags] = useState(doc.tags.join(", "));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTitle(doc.title); setDescription(doc.description); setFolder(doc.folder); setTags(doc.tags.join(", ")); }, [doc]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await update({
        data: {
          id: doc.id, title, description, folder,
          tags: tags.split(",").map((t: string) => t.trim()).filter(Boolean),
          file: file ? { fileName: file.name, mimeType: guessMime(file), base64: await fileToBase64(file) } : undefined,
        },
      });
      toast.success("Document updated");
      setFile(null);
      onDone();
    } catch (err: any) {
      toast.error(err.message);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-6 shadow-card">
      <h2 className="font-semibold">Edit</h2>
      <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="space-y-1.5"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label>Folder</Label><Input value={folder} onChange={(e) => setFolder(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Tags</Label><Input value={tags} onChange={(e) => setTags(e.target.value)} /></div>
      </div>
      <div className="space-y-1.5"><Label>Replace file (new version)</Label><Input type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
    </form>
  );
}

function SharePanel({ docId, permissions, onDone }: { docId: string; permissions: any[]; onDone: () => void }) {
  const grant = useServerFn(grantPermission);
  const revoke = useServerFn(revokePermission);
  const [email, setEmail] = useState("");
  const [canEdit, setCanEdit] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await grant({ data: { documentId: docId, email, canEdit } });
      toast.success("Access granted");
      setEmail("");
      onDone();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function setLevel(email: string, edit: boolean) {
    try { await grant({ data: { documentId: docId, email, canEdit: edit } }); onDone(); } catch (err: any) { toast.error(err.message); }
  }

  async function remove(userId: string) {
    try { await revoke({ data: { documentId: docId, userId } }); toast.success("Access revoked"); onDone(); } catch (err: any) { toast.error(err.message); }
  }

  return (
    <section className="h-fit rounded-lg border bg-card p-6 shadow-card">
      <h2 className="font-semibold">Sharing</h2>
      <p className="mt-1 text-xs text-muted-foreground">Revoking takes effect on the very next request.</p>
      <form onSubmit={add} className="mt-4 space-y-3">
        <Input type="email" required placeholder="colleague@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2"><Switch checked={canEdit} onCheckedChange={setCanEdit} /> Can edit</label>
          <Button size="sm" type="submit"><UserPlus className="mr-1 h-4 w-4" /> Grant</Button>
        </div>
      </form>
      <ul className="mt-5 space-y-2">
        {permissions.length === 0 && <li className="text-sm text-muted-foreground">Only you can access this document.</li>}
        {permissions.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
            <div className="min-w-0">
              <div className="truncate">{p.profile?.email}</div>
              <button className="text-xs text-muted-foreground hover:underline" onClick={() => setLevel(p.profile?.email, !p.can_edit)}>
                {p.can_edit ? "Read & edit" : "Read only"} · change
              </button>
            </div>
            <Button size="icon" variant="ghost" onClick={() => remove(p.user_id)} aria-label="Revoke access"><X className="h-4 w-4" /></Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
