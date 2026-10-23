import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { FileText, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { listDocuments, uploadDocument } from "@/lib/vault.functions";
import { fileToBase64, formatBytes, ACCEPT, guessMime } from "@/lib/file-reader";
import { useMe } from "./route";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/vault")({
  head: () => ({ meta: [{ title: "Documents — TrustVault" }, { name: "description", content: "Your secure documents." }] }),
  component: Vault,
});

function Vault() {
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("");
  const list = useServerFn(listDocuments);
  const { data: me } = useMe();
  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["docs", q, folder],
    queryFn: () => list({ data: { q, folder: folder || undefined } }),
  });
  const { data: all = [] } = useQuery({ queryKey: ["docs", "", ""], queryFn: () => list({ data: {} }) });
  const folders = useMemo(() => [...new Set(all.map((d: any) => d.folder))].sort(), [all]);
  const canUpload = me?.roles.some((r) => r === "owner" || r === "admin");

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Documents</h1>
          <p className="text-sm text-muted-foreground">Files you own and files shared with you.</p>
        </div>
        {canUpload && <UploadDialog />}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search title, tag, description…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1">
          {["", ...folders].map((f) => (
            <Button key={f || "all"} size="sm" variant={folder === f ? "default" : "outline"} onClick={() => setFolder(f)}>
              {f || "All folders"}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border bg-card shadow-card">
        {isLoading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : docs.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No documents yet.{canUpload ? " Upload your first confidential file." : " Nothing has been shared with you."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Folder</th>
                <th className="px-4 py-3">Access</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d: any) => (
                <tr key={d.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link to="/documents/$id" params={{ id: d.id }} className="flex items-center gap-2 font-medium hover:underline">
                      <FileText className="h-4 w-4 text-muted-foreground" /> {d.title}
                    </Link>
                    <div className="mt-1 flex gap-1">
                      {d.tags.map((t: string) => (
                        <Badge key={t} variant="secondary" className="font-normal">{t}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{d.folder}</td>
                  <td className="px-4 py-3">
                    <Badge variant={d.access === "owner" ? "accent" : d.access === "edit" ? "success" : "outline"}>{d.access}</Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{formatBytes(d.size_bytes)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(d.updated_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function UploadDialog() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [folder, setFolder] = useState("General");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const upload = useServerFn(uploadDocument);
  const qc = useQueryClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error("File exceeds 10 MB limit");
    setBusy(true);
    try {
      await upload({
        data: {
          title: title || file.name,
          description,
          folder,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          fileName: file.name,
          mimeType: guessMime(file),
          base64: await fileToBase64(file),
        },
      });
      toast.success("Document uploaded");
      qc.invalidateQueries({ queryKey: ["docs"] });
      setOpen(false);
      setFile(null); setTitle(""); setDescription(""); setTags("");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Upload className="mr-2 h-4 w-4" /> Upload</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Upload document</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>File</Label>
            <Input type="file" accept={ACCEPT} required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <p className="text-xs text-muted-foreground">PDF, images, text, CSV or Office files · max 10 MB</p>
          </div>
          <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file?.name} /></div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Folder</Label><Input value={folder} onChange={(e) => setFolder(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Tags</Label><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="legal, q3" /></div>
          </div>
          <Button type="submit" className="w-full" disabled={busy || !file}>{busy ? "Encrypting & uploading…" : "Upload"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
