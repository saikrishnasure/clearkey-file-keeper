import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateFile, sanitizeText } from "./file-validation";

type Ctx = { supabase: any; userId: string; claims: any };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function audit(
  ctx: Ctx,
  action: string,
  opts: { documentId?: string | null; documentTitle?: string | null; success?: boolean; details?: Record<string, unknown> } = {},
) {
  const db = await admin();
  await db.from("audit_logs").insert({
    actor_id: ctx.userId,
    actor_email: (ctx.claims?.email as string) ?? null,
    action,
    document_id: opts.documentId ?? null,
    document_title: opts.documentTitle ?? null,
    success: opts.success ?? true,
    details: (opts.details ?? {}) as any,
  });
}

async function getRoles(ctx: Ctx): Promise<string[]> {
  const { data } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  return (data ?? []).map((r: any) => r.role);
}

async function requireRole(ctx: Ctx, roles: string[], action: string) {
  const mine = await getRoles(ctx);
  if (!mine.some((r) => roles.includes(r))) {
    await audit(ctx, "access_denied", { success: false, details: { attempted: action, reason: "role" } });
    throw new Error("Forbidden: your role does not allow this action");
  }
}

/** Server-side authorization for a document. Logs denials. Returns the document row. */
async function requireDoc(ctx: Ctx, id: string, mode: "read" | "edit" | "owner", action: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid document id");
  const db = await admin();
  const { data: doc } = await db.from("documents").select("*").eq("id", id).maybeSingle();
  let allowed = false;
  if (doc) {
    if (doc.owner_id === ctx.userId) allowed = true;
    else if (mode !== "owner") {
      const { data } = await ctx.supabase.rpc("can_access_document", { _doc: id, _user: ctx.userId, _mode: mode });
      allowed = data === true;
    }
  }
  if (!doc || !allowed) {
    await audit(ctx, "access_denied", {
      documentId: doc ? id : null,
      documentTitle: doc?.title ?? null,
      success: false,
      details: { attempted: action, mode },
    });
    throw new Error("Access denied");
  }
  return doc;
}

function decode(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256(bytes: Uint8Array) {
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.map((t) => sanitizeText(String(t), 30)).filter(Boolean).slice(0, 10);
}

export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const roles = await getRoles(context as Ctx);
    const { data: profile } = await context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle();
    return { userId: context.userId, roles, profile };
  });

export const listDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { q?: string; folder?: string }) => i)
  .handler(async ({ data, context }) => {
    const { data: perms } = await context.supabase
      .from("document_permissions")
      .select("document_id, can_read, can_edit")
      .eq("user_id", context.userId);
    const shared = new Map<string, { can_read: boolean; can_edit: boolean }>(
      (perms ?? []).map((p: any) => [p.document_id, p]),
    );
    const ids = [...shared.keys()];
    let query = context.supabase.from("documents").select("*").order("updated_at", { ascending: false });
    query = ids.length
      ? query.or(`owner_id.eq.${context.userId},id.in.(${ids.join(",")})`)
      : query.eq("owner_id", context.userId);
    if (data.folder) query = query.eq("folder", data.folder);
    const { data: docs, error } = await query;
    if (error) throw new Error(error.message);
    const q = (data.q ?? "").toLowerCase().trim();
    const filtered = (docs ?? []).filter(
      (d: any) =>
        !q ||
        d.title.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.file_name.toLowerCase().includes(q) ||
        d.tags.some((t: string) => t.toLowerCase().includes(q)),
    );
    return filtered.map((d: any) => ({
      ...d,
      access: d.owner_id === context.userId ? "owner" : shared.get(d.id)?.can_edit ? "edit" : "read",
    }));
  });

export const uploadDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: { title: string; description: string; folder: string; tags: string[]; fileName: string; mimeType: string; base64: string }) => i,
  )
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireRole(ctx, ["owner", "admin"], "upload");
    const bytes = decode(data.base64);
    const err = validateFile(data.fileName, data.mimeType, bytes);
    if (err) {
      await audit(ctx, "upload_rejected", { success: false, details: { reason: err, file: data.fileName.slice(0, 100) } });
      throw new Error(err);
    }
    const title = sanitizeText(data.title, 150) || data.fileName;
    const db = await admin();
    const id = crypto.randomUUID();
    const path = `${ctx.userId}/${id}/v1`;
    const up = await db.storage.from("documents").upload(path, bytes, { contentType: data.mimeType });
    if (up.error) throw new Error("Upload failed");
    const { error } = await db.from("documents").insert({
      id,
      owner_id: ctx.userId,
      title,
      description: sanitizeText(data.description ?? "", 1000),
      folder: sanitizeText(data.folder ?? "", 60) || "General",
      tags: cleanTags(data.tags),
      file_path: path,
      file_name: data.fileName,
      mime_type: data.mimeType,
      size_bytes: bytes.length,
      sha256: await sha256(bytes),
    });
    if (error) throw new Error(error.message);
    await audit(ctx, "upload", { documentId: id, documentTitle: title, details: { size: bytes.length } });
    return { id };
  });

export const getDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const doc = await requireDoc(ctx, data.id, "read", "view");
    const isOwner = doc.owner_id === ctx.userId;
    const { data: canEdit } = await ctx.supabase.rpc("can_access_document", { _doc: doc.id, _user: ctx.userId, _mode: "edit" });
    const db = await admin();
    const { data: owner } = await db.from("profiles").select("email, display_name").eq("id", doc.owner_id).maybeSingle();
    let permissions: any[] = [];
    let activity: any[] = [];
    if (isOwner) {
      const { data: p } = await db.from("document_permissions").select("*").eq("document_id", doc.id);
      const uids = (p ?? []).map((x: any) => x.user_id);
      const { data: profs } = uids.length ? await db.from("profiles").select("id, email, display_name").in("id", uids) : { data: [] };
      permissions = (p ?? []).map((x: any) => ({ ...x, profile: (profs ?? []).find((pr: any) => pr.id === x.user_id) }));
      const { data: a } = await db
        .from("audit_logs")
        .select("id, action, actor_email, success, details, created_at")
        .eq("document_id", doc.id)
        .order("id", { ascending: false })
        .limit(50);
      activity = a ?? [];
    }
    return { doc, owner, isOwner, canEdit: canEdit === true, permissions, activity };
  });

export const downloadDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const doc = await requireDoc(ctx, data.id, "read", "download");
    const db = await admin();
    const { data: signed, error } = await db.storage
      .from("documents")
      .createSignedUrl(doc.file_path, 60, { download: doc.file_name });
    if (error || !signed) throw new Error("Could not prepare download");
    await audit(ctx, "download", { documentId: doc.id, documentTitle: doc.title });
    return { url: signed.signedUrl };
  });

export const updateDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: { id: string; title: string; description: string; folder: string; tags: string[]; file?: { fileName: string; mimeType: string; base64: string } }) => i,
  )
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const doc = await requireDoc(ctx, data.id, "edit", "modify");
    const db = await admin();
    const patch: Record<string, unknown> = {
      title: sanitizeText(data.title, 150) || doc.title,
      description: sanitizeText(data.description ?? "", 1000),
      folder: sanitizeText(data.folder ?? "", 60) || "General",
      tags: cleanTags(data.tags),
      updated_at: new Date().toISOString(),
    };
    const changes: string[] = ["metadata"];
    if (data.file) {
      const bytes = decode(data.file.base64);
      const err = validateFile(data.file.fileName, data.file.mimeType, bytes);
      if (err) throw new Error(err);
      const version = doc.version + 1;
      const path = `${doc.owner_id}/${doc.id}/v${version}`;
      const up = await db.storage.from("documents").upload(path, bytes, { contentType: data.file.mimeType });
      if (up.error) throw new Error("Upload failed");
      Object.assign(patch, {
        file_path: path,
        file_name: data.file.fileName,
        mime_type: data.file.mimeType,
        size_bytes: bytes.length,
        sha256: await sha256(bytes),
        version,
      });
      changes.push(`file v${version}`);
    }
    const { error } = await db.from("documents").update(patch).eq("id", doc.id);
    if (error) throw new Error(error.message);
    await audit(ctx, "modify", { documentId: doc.id, documentTitle: patch.title as string, details: { changes } });
    return { ok: true };
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const doc = await requireDoc(ctx, data.id, "owner", "delete");
    const db = await admin();
    const { data: files } = await db.storage.from("documents").list(`${doc.owner_id}/${doc.id}`);
    if (files?.length) await db.storage.from("documents").remove(files.map((f) => `${doc.owner_id}/${doc.id}/${f.name}`));
    await db.from("documents").delete().eq("id", doc.id);
    await audit(ctx, "delete", { documentId: doc.id, documentTitle: doc.title });
    return { ok: true };
  });

export const grantPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { documentId: string; email: string; canEdit: boolean }) => i)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const doc = await requireDoc(ctx, data.documentId, "owner", "grant_permission");
    const db = await admin();
    const email = data.email.trim().toLowerCase();
    const { data: target } = await db.from("profiles").select("id, email").ilike("email", email).maybeSingle();
    if (!target) throw new Error("No TrustVault user with that email");
    if (target.id === ctx.userId) throw new Error("You already own this document");
    const { error } = await db
      .from("document_permissions")
      .upsert(
        { document_id: doc.id, user_id: target.id, can_read: true, can_edit: !!data.canEdit, granted_by: ctx.userId },
        { onConflict: "document_id,user_id" },
      );
    if (error) throw new Error(error.message);
    await audit(ctx, "permission_granted", {
      documentId: doc.id,
      documentTitle: doc.title,
      details: { target: target.email, level: data.canEdit ? "edit" : "read" },
    });
    return { ok: true };
  });

export const revokePermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { documentId: string; userId: string }) => i)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const doc = await requireDoc(ctx, data.documentId, "owner", "revoke_permission");
    const db = await admin();
    const { data: prof } = await db.from("profiles").select("email").eq("id", data.userId).maybeSingle();
    await db.from("document_permissions").delete().eq("document_id", doc.id).eq("user_id", data.userId);
    await audit(ctx, "permission_revoked", { documentId: doc.id, documentTitle: doc.title, details: { target: prof?.email } });
    return { ok: true };
  });

// ---------- Admin ----------

export const adminOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { action?: string; deniedOnly?: boolean }) => i)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireRole(ctx, ["admin"], "admin_dashboard");
    const db = await admin();
    let logs = db.from("audit_logs").select("*").order("id", { ascending: false }).limit(200);
    if (data.action) logs = logs.eq("action", data.action);
    if (data.deniedOnly) logs = logs.eq("success", false);
    const [l, docs, perms, users, roles, denied] = await Promise.all([
      logs,
      db.from("documents").select("id", { count: "exact", head: true }),
      db.from("document_permissions").select("id", { count: "exact", head: true }),
      db.from("profiles").select("id, email, display_name, created_at").order("created_at"),
      db.from("user_roles").select("user_id, role"),
      db.from("audit_logs").select("id", { count: "exact", head: true }).eq("success", false),
    ]);
    const userList = (users.data ?? []).map((u: any) => ({
      ...u,
      roles: (roles.data ?? []).filter((r: any) => r.user_id === u.id).map((r: any) => r.role),
    }));
    return {
      logs: l.data ?? [],
      stats: { documents: docs.count ?? 0, permissions: perms.count ?? 0, users: userList.length, denied: denied.count ?? 0 },
      users: userList,
    };
  });

export const verifyAuditChain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as Ctx;
    await requireRole(ctx, ["admin"], "verify_audit_chain");
    const { data, error } = await ctx.supabase.rpc("verify_audit_chain");
    if (error) throw new Error(error.message);
    return (data as any)?.[0] as { valid: boolean; checked: number; broken_at: number | null };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { userId: string; role: "admin" | "owner" | "viewer"; enabled: boolean }) => i)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireRole(ctx, ["admin"], "change_role");
    if (!["admin", "owner", "viewer"].includes(data.role)) throw new Error("Invalid role");
    if (data.userId === ctx.userId && data.role === "admin" && !data.enabled) throw new Error("You cannot remove your own admin role");
    const db = await admin();
    if (data.enabled) await db.from("user_roles").upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
    else await db.from("user_roles").delete().eq("user_id", data.userId).eq("role", data.role);
    const { data: prof } = await db.from("profiles").select("email").eq("id", data.userId).maybeSingle();
    await audit(ctx, "role_changed", { details: { target: prof?.email, role: data.role, enabled: data.enabled } });
    return { ok: true };
  });
