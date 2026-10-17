-- =====================================================================
--  GESTION IEPP — Comptes du personnel (enseignants) par MATRICULE
--  • Un agent enregistré dans « Personnel » (avec son matricule et son
--    affectation dans une école) crée lui-même son compte : matricule +
--    nom de famille + mot de passe de son choix.
--  • Il se connecte ensuite avec son MATRICULE et son mot de passe.
--  • Il ne voit que son école et seulement les rubriques autorisées
--    (par défaut : Compositions, Relevés de notes, Élèves, Suivi de la
--    saisie, Cartes scolaires). Le superviseur peut en ajouter dans
--    Paramétrage → « Accès du personnel ».
--  À lancer APRÈS 008 et 012. Peut être relancé sans risque.
-- =====================================================================

-- 1. Nouveau type de compte « enseignant »
alter type role_utilisateur add value if not exists 'enseignant';

-- 2. Un enseignant est rattaché à une circonscription et à une école
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.profils'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%superviseur%' loop
    execute format('alter table profils drop constraint %I', c.conname);
  end loop;
end $$;
alter table profils add constraint profils_perimetre_check check (
     (role::text = 'superviseur')
  or (role::text = 'iepp' and iepp_id is not null)
  or (role::text = 'conseiller' and iepp_id is not null and secteur_id is not null)
  or (role::text in ('directeur', 'saisie', 'enseignant') and iepp_id is not null and ecole_id is not null)
);

-- 3. L'enseignant voit les données de son école (comme le directeur)
create or replace function peut_voir_ecole(p_ecole uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from profils p
    join ecoles e on e.id = p_ecole
    where p.id = auth.uid() and p.actif and (
         p.role::text = 'superviseur'
      or (p.role::text = 'iepp'       and e.iepp_id = p.iepp_id)
      or (p.role::text = 'conseiller' and e.secteur_id = p.secteur_id)
      or (p.role::text in ('directeur', 'saisie', 'enseignant') and e.id = p.ecole_id)
    )
  )
$$;

-- 4. L'inspecteur peut aussi gérer (bloquer, nouveau mot de passe…) les comptes enseignants
create or replace function peut_gerer_compte(p_role role_utilisateur, p_iepp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select est_superviseur()
      or (mon_role() = 'iepp' and p_iepp = mon_iepp() and p_role::text in ('conseiller', 'directeur', 'saisie', 'enseignant'))
$$;

-- 5. Rubriques accessibles par type de compte (modifiable par le superviseur)
create table if not exists acces_roles (
  role       text primary key,
  rubriques  text[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into acces_roles (role, rubriques)
values ('enseignant', array['/compositions', '/releves', '/eleves', '/suivi-saisie', '/cartes'])
on conflict (role) do nothing;
alter table acces_roles enable row level security;
drop policy if exists acces_roles_lecture on acces_roles;
drop policy if exists acces_roles_ecriture on acces_roles;
create policy acces_roles_lecture on acces_roles for select to authenticated using (true);
create policy acces_roles_ecriture on acces_roles for all to authenticated using (est_superviseur()) with check (est_superviseur());
grant select, insert, update, delete on acces_roles to authenticated, service_role;

-- 6. Identifiant de connexion : email, téléphone ou matricule
create or replace function identifiant_vers_email(p text) returns text
language sql immutable as $$
  select case
    when p is null or trim(p) = '' then null
    when position('@' in p) > 0 then lower(trim(p))
    when p ~ '[A-Za-z]' then lower(regexp_replace(p, '[^A-Za-z0-9]', '', 'g')) || '@mat.gestion-iepp.ci'
    else regexp_replace(p, '[^0-9]', '', 'g') || '@tel.gestion-iepp.ci'
  end
$$;

-- 7. Création du compte par l'agent lui-même (matricule + nom de famille + mot de passe)
create or replace function inscription_personnel(
  p_matricule text, p_nom text, p_mot_de_passe text, p_telephone text default null)
returns text language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_mat    text := upper(regexp_replace(coalesce(p_matricule, ''), '[^A-Za-z0-9]', '', 'g'));
  v_email  text := lower(v_mat) || '@mat.gestion-iepp.ci';
  v_pers   personnel%rowtype;
  v_aff    affectations%rowtype;
  v_id     uuid := gen_random_uuid();
begin
  if v_mat = '' then raise exception 'Indiquez votre matricule.'; end if;
  if length(coalesce(p_mot_de_passe, '')) < 8 then raise exception 'Le mot de passe doit contenir au moins 8 caractères.'; end if;
  select * into v_pers from personnel
   where upper(regexp_replace(coalesce(matricule, ''), '[^A-Za-z0-9]', '', 'g')) = v_mat limit 1;
  if not found then
    raise exception 'Matricule inconnu. Demandez à votre directeur ou à votre inspection de vous enregistrer dans « Personnel » avec votre matricule.';
  end if;
  if upper(trim(coalesce(p_nom, ''))) <> upper(trim(v_pers.nom)) then
    raise exception 'Le nom ne correspond pas à ce matricule. Saisissez votre nom de famille tel qu''il est enregistré.';
  end if;
  if exists (select 1 from profils where personnel_id = v_pers.id) or exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Un compte existe déjà pour ce matricule. Utilisez « Se connecter » (en cas d''oubli du mot de passe, contactez votre inspection).';
  end if;
  select a.* into v_aff from affectations a join annees_scolaires s on s.id = a.annee_id and s.active
   where a.personnel_id = v_pers.id limit 1;
  if not found or v_aff.ecole_id is null then
    raise exception 'Votre affectation dans une école n''est pas encore enregistrée pour cette année. Contactez votre directeur ou votre inspection.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_mot_de_passe, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('nom_complet', v_pers.nom || ' ' || v_pers.prenoms, 'application', 'gestion-iepp', 'matricule', v_mat),
    now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());

  execute 'insert into public.profils (id, nom_complet, role, iepp_id, ecole_id, personnel_id, telephone)
           values ($1, $2, ''enseignant'', $3, $4, $5, $6)'
    using v_id, upper(trim(v_pers.nom || ' ' || v_pers.prenoms)), v_aff.iepp_id, v_aff.ecole_id, v_pers.id,
          coalesce(nullif(trim(coalesce(p_telephone, '')), ''), v_pers.telephone);
  if p_telephone is not null and v_pers.telephone is null then
    update personnel set telephone = trim(p_telephone) where id = v_pers.id;
  end if;

  insert into public.journal (user_id, action, table_cible, cible_id, details)
  values (v_id, 'inscription_personnel', 'profils', v_id, jsonb_build_object('matricule', v_mat));
  return 'actif';
end $$;
revoke all on function inscription_personnel(text, text, text, text) from public;
grant execute on function inscription_personnel(text, text, text, text) to anon, authenticated;
grant execute on function identifiant_vers_email(text) to anon, authenticated;

notify pgrst, 'reload schema';
select 'Comptes du personnel installés' as resultat;
