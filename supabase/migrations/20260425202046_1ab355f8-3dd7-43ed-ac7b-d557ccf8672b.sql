-- Explicit deny-all for client access; service role bypasses RLS so edge functions still work.
CREATE POLICY "Rate limits are server-only"
  ON public.rate_limits
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);