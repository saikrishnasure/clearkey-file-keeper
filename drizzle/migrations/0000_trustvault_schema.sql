CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TYPE public.app_role AS ENUM ('admin', 'owner', 'viewer');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can view profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  folder text NOT NULL DEFAULT 'General',
  tags text[] NOT NULL DEFAULT '{}',
  file_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.documents(owner_id);
GRANT SELECT ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.document_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  can_read boolean NOT NULL DEFAULT true,
  can_edit boolean NOT NULL DEFAULT false,
  granted_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, user_id)
);
GRANT SELECT ON public.document_permissions TO authenticated;
GRANT ALL ON public.document_permissions TO service_role;
ALTER TABLE public.document_permissions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_document(_doc uuid, _user uuid, _mode text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = _doc AND d.owner_id = _user)
    OR EXISTS (SELECT 1 FROM public.document_permissions p WHERE p.document_id = _doc AND p.user_id = _user
               AND ((_mode = 'read' AND (p.can_read OR p.can_edit)) OR (_mode = 'edit' AND p.can_edit)))
$$;

CREATE POLICY "Read accessible documents" ON public.documents FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.can_access_document(id, auth.uid(), 'read') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "See relevant permissions" ON public.document_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.documents d WHERE d.id = document_id AND d.owner_id = auth.uid()));

-- Tamper-evident audit log (hash chain, append-only)
CREATE TABLE public.audit_logs (
  id bigserial PRIMARY KEY,
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  document_id uuid,
  document_title text,
  success boolean NOT NULL DEFAULT true,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  prev_hash text NOT NULL DEFAULT '',
  hash text NOT NULL DEFAULT ''
);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO service_role;
GRANT USAGE ON SEQUENCE public.audit_logs_id_seq TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read all logs, users read own" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR actor_id = auth.uid());

CREATE OR REPLACE FUNCTION public.audit_hash_chain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(424242);
  SELECT hash INTO last_hash FROM public.audit_logs ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := COALESCE(last_hash, 'GENESIS');
  NEW.created_at := now();
  NEW.hash := encode(extensions.digest(
    NEW.prev_hash || '|' || NEW.id::text || '|' || COALESCE(NEW.actor_id::text,'') || '|' || NEW.action || '|' ||
    COALESCE(NEW.document_id::text,'') || '|' || NEW.success::text || '|' || NEW.details::text || '|' ||
    to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER audit_logs_chain BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.audit_hash_chain();

CREATE OR REPLACE FUNCTION public.audit_block_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit log is append-only'; END $$;
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.audit_block_changes();

-- Verify chain integrity
CREATE OR REPLACE FUNCTION public.verify_audit_chain()
RETURNS TABLE(valid boolean, checked bigint, broken_at bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE r record; prev text := 'GENESIS'; n bigint := 0; h text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  FOR r IN SELECT * FROM public.audit_logs ORDER BY id LOOP
    n := n + 1;
    h := encode(extensions.digest(
      r.prev_hash || '|' || r.id::text || '|' || COALESCE(r.actor_id::text,'') || '|' || r.action || '|' ||
      COALESCE(r.document_id::text,'') || '|' || r.success::text || '|' || r.details::text || '|' ||
      to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex');
    IF r.prev_hash <> prev OR r.hash <> h THEN
      valid := false; checked := n; broken_at := r.id; RETURN NEXT; RETURN;
    END IF;
    prev := r.hash;
  END LOOP;
  valid := true; checked := n; broken_at := NULL; RETURN NEXT;
END $$;
GRANT EXECUTE ON FUNCTION public.verify_audit_chain() TO authenticated;

-- New user: profile + role (first user becomes admin)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, COALESCE(NEW.email, ''), COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(COALESCE(NEW.email,''), '@', 1)));
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner');
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();