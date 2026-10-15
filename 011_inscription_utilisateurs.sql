-- =====================================================================
--  GESTION IEPP — Inscription de tous les utilisateurs + connexion par téléphone
--  • L'email reste l'identifiant du superviseur.
--  • Les utilisateurs créent leur compte depuis la page de connexion :
--      - Inspecteur : compte actif tout de suite (1 seul par IEPP),
--        puis abonnement + code d'activation ;
--      - Conseiller, directeur, agent de saisie : compte « en attente »
--        jusqu'à sa validation par l'inspecteur (ou le superviseur).
--  • Sans adresse email, on s'inscrit et on se connecte avec son numéro de
--    téléphone (identifiant interne : 0700000000@tel.gestion-iepp.ci).
--  À lancer APRÈS 008. Peut être relancé sans risque.
-- =====================================================================

alter table profils add column if not exists telephone text;
alter table profils add column if not exists motif_blocage text;

-- Identifiant de connexion : email tel quel, ou numéro de téléphone → email interne
create or replace function identifiant_vers_email(p text) returns text
language sql immutable as $$
  select case
    when p is null or trim(p) = '' then null
    when position('@' in p) > 0 then lower(trim(p))
    else regexp_replace(p, '[^0-9]', '', 'g') || '@tel.gestion-iepp.ci'
  end
$$;

-- Liste publique des circonscriptions (formulaire d'inscription, avant connexion)
create or replace function iepp_inscription()
returns table (id uuid, nom text, drena_id uuid, drena text, a_un_inspecteur boolean)
language sql stable security definer set search_path = public as $$
  select i.id, i.nom, d.id, d.nom,
         exists (select 1 from profils p where p.iepp_id = i.id and p.role = 'iepp')
    from iepp i left join drena d on d.id = i.drena_id
   order by d.nom, i.nom
$$;

-- Secteurs et écoles d'une IEPP (formulaire d'inscription)
create or replace function structures_inscription(p_iepp uuid)
returns table (type text, id uuid, nom text)
language sql stable security definer set search_path = public as $$
  select 'secteur', s.id, s.nom from secteurs s where s.iepp_id = p_iepp
  union all
  select 'ecole', e.id, e.nom from ecoles e where e.iepp_id = p_iepp and e.actif
  order by 1, 3
$$;

-- Inscription d'un utilisateur
create or replace function inscription_utilisateur(
  p_identifiant text, p_mot_de_passe text, p_nom_complet text, p_role role_utilisateur,
  p_iepp uuid, p_secteur uuid default null, p_ecole uuid default null, p_telephone text default null)
returns text language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_id     uuid := gen_random_uuid();
  v_email  text := identifiant_vers_email(coalesce(nullif(trim(p_identifiant), ''), p_telephone));
  v_tel    text := nullif(trim(coalesce(p_telephone, '')), '');
  v_actif  boolean := (p_role = 'iepp');
begin
  if p_role not in ('iepp', 'conseiller', 'directeur', 'saisie') then
    raise exception 'Type de compte non autorisé.';
  end if;
  if coalesce(trim(p_nom_complet), '') = '' then raise exception 'Indiquez vos nom et prénoms.'; end if;
  if v_tel is null or length(regexp_replace(v_tel, '[^0-9]', '', 'g')) < 8 then
    raise exception 'Indiquez un numéro de téléphone valide.';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Adresse email invalide.'; end if;
  if length(coalesce(p_mot_de_passe, '')) < 8 then raise exception 'Le mot de passe doit contenir au moins 8 caractères.'; end if;
  if not exists (select 1 from iepp where id = p_iepp) then raise exception 'Choisissez votre circonscription (IEPP).'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Cet email ou ce numéro a déjà un compte. Utilisez « Se connecter ».';
  end if;
  if p_role = 'iepp' and exists (select 1 from profils where iepp_id = p_iepp and role = 'iepp') then
    raise exception 'Cette circonscription a déjà un compte inspecteur. Contactez le gestionnaire pour toute réclamation.';
  end if;
  if p_role = 'conseiller' and not exists (select 1 from secteurs where id = p_secteur and iepp_id = p_iepp) then
    raise exception 'Choisissez votre secteur pédagogique.';
  end if;
  if p_role in ('directeur', 'saisie') and not exists (select 1 from ecoles where id = p_ecole and iepp_id = p_iepp) then
    raise exception 'Choisissez votre école.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_mot_de_passe, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('nom_complet', trim(p_nom_complet), 'application', 'gestion-iepp', 'inscription', true),
    now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());

  insert into public.profils (id, nom_complet, role, iepp_id, secteur_id, ecole_id, telephone, actif, motif_blocage)
  values (v_id, upper(trim(p_nom_complet)), p_role, p_iepp,
          case when p_role = 'conseiller' then p_secteur end,
          case when p_role in ('directeur', 'saisie') then p_ecole end,
          v_tel, v_actif,
          case when v_actif then null else 'Compte en attente de validation par votre inspecteur.' end);

  insert into public.journal (user_id, action, table_cible, cible_id, details)
  values (v_id, 'inscription', 'profils', v_id, jsonb_build_object('identifiant', v_email, 'role', p_role, 'iepp_id', p_iepp));
  return case when v_actif then 'actif' else 'en_attente' end;
end $$;

revoke all on function inscription_utilisateur(text, text, text, role_utilisateur, uuid, uuid, uuid, text) from public;
grant execute on function inscription_utilisateur(text, text, text, role_utilisateur, uuid, uuid, uuid, text) to anon, authenticated;
grant execute on function iepp_inscription() to anon, authenticated;
grant execute on function structures_inscription(uuid) to anon, authenticated;
grant execute on function identifiant_vers_email(text) to anon, authenticated;

notify pgrst, 'reload schema';
select 'Inscription des utilisateurs installée' as resultat;
