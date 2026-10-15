-- =====================================================================
--  GESTION IEPP — « Créer mon compte » depuis la page de connexion
--  L'inspecteur d'une circonscription crée lui-même son compte :
--  DRENA → IEPP, nom, téléphone, email, mot de passe.
--  Il arrive ensuite sur la page Abonnement (paiement + code d'activation).
--  Une IEPP ne peut avoir qu'un seul compte inspecteur créé de cette façon :
--  si elle en a déjà un, l'inscription est refusée.
--  À lancer APRÈS 008. Peut être relancé sans risque.
-- =====================================================================

alter table profils add column if not exists telephone text;

-- Liste publique des circonscriptions (pour le formulaire d'inscription, avant connexion)
create or replace function iepp_inscription()
returns table (id uuid, nom text, drena_id uuid, drena text, a_un_inspecteur boolean)
language sql stable security definer set search_path = public as $$
  select i.id, i.nom, d.id, d.nom,
         exists (select 1 from profils p where p.iepp_id = i.id and p.role = 'iepp')
    from iepp i left join drena d on d.id = i.drena_id
   order by d.nom, i.nom
$$;

-- Inscription d'un inspecteur
create or replace function inscription_inspecteur(
  p_email text, p_mot_de_passe text, p_nom_complet text, p_iepp uuid, p_telephone text default null)
returns uuid language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
begin
  if coalesce(trim(p_nom_complet), '') = '' then raise exception 'Indiquez vos nom et prénoms.'; end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Adresse email invalide.'; end if;
  if length(coalesce(p_mot_de_passe, '')) < 8 then raise exception 'Le mot de passe doit contenir au moins 8 caractères.'; end if;
  if not exists (select 1 from iepp where id = p_iepp) then raise exception 'Choisissez votre circonscription (IEPP).'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Cet email a déjà un compte. Utilisez « Se connecter ».';
  end if;
  if exists (select 1 from profils where iepp_id = p_iepp and role = 'iepp') then
    raise exception 'Cette circonscription a déjà un compte inspecteur. Contactez le gestionnaire pour toute réclamation.';
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

  insert into public.profils (id, nom_complet, role, iepp_id, telephone)
  values (v_id, upper(trim(p_nom_complet)), 'iepp', p_iepp, nullif(trim(coalesce(p_telephone, '')), ''));

  insert into public.journal (user_id, action, table_cible, cible_id, details)
  values (v_id, 'inscription_inspecteur', 'profils', v_id, jsonb_build_object('email', v_email, 'iepp_id', p_iepp));
  return v_id;
end $$;

revoke all on function inscription_inspecteur(text, text, text, uuid, text) from public;
grant execute on function inscription_inspecteur(text, text, text, uuid, text) to anon, authenticated;
grant execute on function iepp_inscription() to anon, authenticated;

notify pgrst, 'reload schema';
select 'Inscription des inspecteurs installée' as resultat;
