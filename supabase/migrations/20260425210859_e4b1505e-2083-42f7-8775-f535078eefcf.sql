-- 1. Move extensions out of public schema
CREATE SCHEMA IF NOT EXISTS extensions;

-- pg_net and pg_cron may not move cleanly via ALTER EXTENSION SET SCHEMA; recreate
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net' AND extnamespace = 'public'::regnamespace) THEN
    BEGIN
      ALTER EXTENSION pg_net SET SCHEMA extensions;
    EXCEPTION WHEN OTHERS THEN
      -- ignore; some extensions are pinned to public
      NULL;
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron' AND extnamespace = 'public'::regnamespace) THEN
    BEGIN
      ALTER EXTENSION pg_cron SET SCHEMA extensions;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END $$;

-- 2. Realtime authorization: scope subscriptions to runs the caller owns.
-- Topic convention: clients subscribe to channel "runs:<run_id>".
-- Allow only if the run's owner_user_id matches auth.uid() OR the run is anonymous
-- (owner_user_id IS NULL) — anonymous runs are still publicly viewable by ID
-- (matching the existing public SELECT policy on runs), so subscribing is fine.

-- On a hosted Supabase project row-level security is already on for realtime.messages and the
-- table belongs to the platform, so "ALTER TABLE ... ENABLE ROW LEVEL SECURITY" stops with
-- "must be owner of table messages" (seen 14 Nov 2026 on a new project). Enable it only where
-- it is off (the local stack, after supabase/local-bootstrap.sql).
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL
     AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'realtime.messages'::regclass) THEN
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DROP POLICY IF EXISTS "Authenticated users can subscribe to their own run channels" ON realtime.messages;
CREATE POLICY "Authenticated users can subscribe to their own run channels"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- topic format: "runs:<uuid>" or generic non-runs topics pass through
  CASE
    WHEN realtime.topic() LIKE 'runs:%' THEN
      EXISTS (
        SELECT 1 FROM public.runs r
        WHERE r.id::text = substring(realtime.topic() from 6)
          AND (r.owner_user_id = auth.uid() OR r.owner_user_id IS NULL)
      )
    ELSE true
  END
);

DROP POLICY IF EXISTS "Anonymous users can subscribe to anonymous run channels" ON realtime.messages;
CREATE POLICY "Anonymous users can subscribe to anonymous run channels"
ON realtime.messages
FOR SELECT
TO anon
USING (
  CASE
    WHEN realtime.topic() LIKE 'runs:%' THEN
      EXISTS (
        SELECT 1 FROM public.runs r
        WHERE r.id::text = substring(realtime.topic() from 6)
          AND r.owner_user_id IS NULL
      )
    ELSE true
  END
);