-- =====================================================================
--  GESTION IEPP — Gestion des comptes SANS serveur Render
--  Création de comptes, nouveau mot de passe, suppression et emails :
--  tout se fait directement dans Supabase, de façon sécurisée.
--  À coller dans Supabase > SQL Editor > New query, puis Run.
--  Peut être relancé sans risque.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- L'appelant peut-il gérer un compte de ce rôle dans cette circonscription ?
create or replace function peut_gerer_compte(p_role role_utilisateur, p_iepp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select est_superviseur()
      or (mon_role() = 'iepp' and p_iepp = mon_iepp() and p_role in ('conseiller', 'directeur', 'saisie'))
$$;

-- Emails et dernière connexion des comptes visibles
create or replace function comptes_emails()
returns table (id uuid, email text, derniere_connexion timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text, u.last_sign_in_at
    from auth.users u join public.profils p on p.id = u.id
   where est_superviseur() or (mon_role() = 'iepp' and p.iepp_id = mon_iepp())
$$;

-- Création d'un compte (email + mot de passe + profil)
create or replace function creer_compte(
  p_email text, p_mot_de_passe text, p_nom_complet text, p_role role_utilisateur,
  p_iepp uuid default null, p_secteur uuid default null, p_ecole uuid default null)
returns uuid language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
  v_iepp  uuid := case when p_role = 'superviseur' then null else p_iepp end;
begin
  if not peut_gerer_compte(p_role, v_iepp) then
    raise exception 'Vous ne pouvez pas créer ce type de compte.';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Adresse email invalide.';
  end if;
  if length(coalesce(p_mot_de_passe, '')) < 8 then
    raise exception 'Le mot de passe doit contenir au moins 8 caractères.';
  end if;
  if coalesce(trim(p_nom_complet), '') = '' then
    raise exception 'Le nom est obligatoire.';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Cet email est déjà utilisé.';
  end if;
  if p_role <> 'superviseur' and v_iepp is null then
    raise exception 'Circonscription obligatoire.';
  end if;
  if p_role = 'conseiller' and not exists (select 1 from secteurs where id = p_secteur and iepp_id = v_iepp) then
    raise exception 'Choisissez un secteur de la circonscription.';
  end if;
  if p_role in ('directeur', 'saisie') and not exists (select 1 from ecoles where id = p_ecole and iepp_id = v_iepp) then
    raise exception 'Choisissez une école de la circonscription.';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_mot_de_passe, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('nom_complet', trim(p_nom_complet), 'application', 'gestion-iepp'),
    now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  insert into public.profils (id, nom_complet, role, iepp_id, secteur_id, ecole_id)
  values (v_id, trim(p_nom_complet), p_role, v_iepp,
          case when p_role = 'conseiller' then p_secteur end,
          case when p_role in ('directeur', 'saisie') then p_ecole end);

  insert into public.journal (user_id, action, table_cible, cible_id, details)
  values (auth.uid(), 'creation_compte', 'profils', v_id, jsonb_build_object('email', v_email, 'role', p_role));
  return v_id;
end $$;

-- Nouveau mot de passe pour un compte
create or replace function changer_mot_de_passe_compte(p_id uuid, p_mot_de_passe text)
returns void language plpgsql security definer set search_path = public, auth, extensions as $$
declare v_p profils%rowtype;
begin
  select * into v_p from profils where id = p_id;
  if not found then raise exception 'Compte introuvable.'; end if;
  if not peut_gerer_compte(v_p.role, v_p.iepp_id) then raise exception 'Action non autorisée.'; end if;
  if length(coalesce(p_mot_de_passe, '')) < 8 then
    raise exception 'Le mot de passe doit contenir au moins 8 caractères.';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_mot_de_passe, extensions.gen_salt('bf')), updated_at = now()
   where id = p_id;
  insert into public.journal (user_id, action, table_cible, cible_id) values (auth.uid(), 'reinitialisation_mdp', 'profils', p_id);
end $$;

-- Suppression d'un compte
create or replace function supprimer_compte(p_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_p profils%rowtype;
begin
  if p_id = auth.uid() then raise exception 'Vous ne pouvez pas supprimer votre propre compte.'; end if;
  select * into v_p from profils where id = p_id;
  if not found then raise exception 'Compte introuvable.'; end if;
  if not peut_gerer_compte(v_p.role, v_p.iepp_id) then raise exception 'Action non autorisée.'; end if;
  update public.journal set user_id = null where user_id = p_id;
  delete from auth.users where id = p_id;   -- le profil est supprimé en cascade
  insert into public.journal (user_id, action, table_cible, cible_id, details)
  values (auth.uid(), 'suppression_compte', 'profils', p_id, jsonb_build_object('role', v_p.role));
end $$;

revoke all on function creer_compte(text, text, text, role_utilisateur, uuid, uuid, uuid) from public, anon;
revoke all on function changer_mot_de_passe_compte(uuid, text) from public, anon;
revoke all on function supprimer_compte(uuid) from public, anon;
revoke all on function comptes_emails() from public, anon;
grant execute on function creer_compte(text, text, text, role_utilisateur, uuid, uuid, uuid) to authenticated;
grant execute on function changer_mot_de_passe_compte(uuid, text) to authenticated;
grant execute on function supprimer_compte(uuid) to authenticated;
grant execute on function comptes_emails() to authenticated;
grant execute on function peut_gerer_compte(role_utilisateur, uuid) to authenticated;

notify pgrst, 'reload schema';
select 'Comptes sans serveur installés' as resultat;
