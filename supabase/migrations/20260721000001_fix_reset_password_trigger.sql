-- Bug fix: trg_prevent_reset_flag_bypass blocked ANY non-admin change to
-- must_reset_password unconditionally — including the clear_must_reset_password()
-- RPC's own internal UPDATE. SECURITY DEFINER only elevates row/table
-- permission checks, it does not exempt a call from triggers, so the RPC's
-- own recency check passed but its UPDATE was then rejected by this trigger
-- anyway. This broke the password-reset flow for every first-login teacher
-- and anyone using "Forgot password?". Move the recency check into the
-- trigger itself so it can recognize a legitimate post-password-change clear.
create or replace function public.prevent_reset_flag_bypass()
returns trigger
language plpgsql
as $$
declare
  changed_recently boolean;
begin
  if new.must_reset_password is distinct from old.must_reset_password and not is_admin() then
    select (updated_at > now() - interval '2 minutes') into changed_recently
    from auth.users where id = auth.uid();

    if not coalesce(changed_recently, false) then
      raise exception 'must_reset_password can only be changed by an admin or after an actual password change';
    end if;
  end if;
  return new;
end;
$$;
