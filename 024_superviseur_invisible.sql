-- =====================================================================
--  GESTION IEPP — Compte superviseur invisible pour les autres utilisateurs
--  • Le superviseur voit TOUS les comptes utilisateurs.
--  • Les autres utilisateurs ne voient jamais le compte du superviseur
--    (ni son nom, ni son email, ni son téléphone) : dans la messagerie et
--    le forum, il apparaît seulement comme « Administration Gestion IEPP ».
--  À lancer APRÈS 021 et 022. Peut être relancé sans risque.
-- =====================================================================

-- 1. Comptes : seul le superviseur peut lire un profil superviseur (hors le sien)
drop policy if exists profils_gestion on profils;
create policy profils_gestion on profils for all to authenticated
  using (est_superviseur() or (mon_role() = 'iepp' and iepp_id = mon_iepp() and role::text <> 'superviseur'))
  with check (est_superviseur() or (mon_role() = 'iepp' and iepp_id = mon_iepp() and role::text in ('conseiller', 'directeur', 'saisie', 'enseignant')));

-- 2. Messagerie : le superviseur reste joignable, mais anonyme
create or replace function destinataires_possibles()
returns table (id uuid, nom_complet text, role text, iepp_id uuid, iepp text, drena text,
               ecole text, telephone text, email text)
language sql stable security definer set search_path = public, auth as $$
  select p.id,
         case when p.role::text = 'superviseur' and not est_superviseur() then 'Administration Gestion IEPP' else p.nom_complet end,
         p.role::text, p.iepp_id, i.nom, dr.nom, e.nom,
         case when p.role::text = 'superviseur' and not est_superviseur() then null else coalesce(nullif(p.telephone, ''),
                  case when u.email like '%@tel.gestion-iepp.ci' then split_part(u.email, '@', 1) end) end,
         case when p.role::text = 'superviseur' and not est_superviseur() then null when u.email not like '%@tel.gestion-iepp.ci' and u.email not like '%@mat.gestion-iepp.ci' then u.email::text end
    from profils p
    join auth.users u on u.id = p.id
    left join iepp i on i.id = p.iepp_id
    left join drena dr on dr.id = i.drena_id
    left join ecoles e on e.id = p.ecole_id
   where peut_ecrire_a(p.id)
   order by i.nom nulls first, p.nom_complet
$$;

create or replace function envoyer_message(p_objet text, p_corps text, p_destinataires uuid[], p_reponse_a uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_nb integer;
begin
  if coalesce(trim(p_objet), '') = '' then raise exception 'Indiquez l''objet du message.'; end if;
  if coalesce(trim(p_corps), '') = '' then raise exception 'Le message est vide.'; end if;
  select count(*) into v_nb from unnest(p_destinataires) x where peut_ecrire_a(x);
  if v_nb = 0 then raise exception 'Choisissez au moins un destinataire.'; end if;
  insert into messages (expediteur_id, expediteur_nom, objet, corps, reponse_a)
  values (auth.uid(), (select case when role::text = 'superviseur' then 'Administration Gestion IEPP' else nom_complet end from profils where id = auth.uid()), trim(p_objet), trim(p_corps), p_reponse_a)
  returning id into v_id;
  insert into message_destinataires (message_id, destinataire_id)
  select distinct v_id, x from unnest(p_destinataires) x where peut_ecrire_a(x);
  return v_id;
end $$;

-- 3. Forum : messages du superviseur signés « Administration Gestion IEPP »
create or replace function forum_creer_sujet(p_espace text, p_iepp uuid, p_categorie text, p_titre text, p_contenu text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_iepp uuid := case when p_espace = 'circ' then p_iepp end; moi record;
begin
  if not forum_peut_lire(p_espace, v_iepp) then raise exception 'Vous n''avez pas accès à ce forum.'; end if;
  if coalesce(trim(p_titre), '') = '' or coalesce(trim(p_contenu), '') = '' then raise exception 'Indiquez un titre et un message.'; end if;
  select case when p.role::text = 'superviseur' then 'Administration Gestion IEPP' else p.nom_complet end as nom_complet,
         case when p.role::text = 'superviseur' then null else p.role::text end as role, i.nom as iepp into moi from profils p left join iepp i on i.id = p.iepp_id where p.id = auth.uid();
  insert into forum_sujets (espace, iepp_id, categorie, titre, contenu, auteur_id, auteur_nom, auteur_role, auteur_iepp)
  values (p_espace, v_iepp, coalesce(nullif(trim(p_categorie), ''), 'Divers'), trim(p_titre), trim(p_contenu), auth.uid(), moi.nom_complet, moi.role, moi.iepp)
  returning id into v_id;
  insert into forum_vues (user_id, sujet_id) values (auth.uid(), v_id) on conflict do nothing;
  return v_id;
end $$;

create or replace function forum_repondre(p_sujet uuid, p_contenu text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; s forum_sujets%rowtype; moi record;
begin
  select * into s from forum_sujets where id = p_sujet;
  if not found or not forum_peut_lire(s.espace, s.iepp_id) then raise exception 'Sujet introuvable.'; end if;
  if s.verrouille and not forum_peut_moderer(s.espace, s.iepp_id) then raise exception 'Ce sujet est fermé : on ne peut plus y répondre.'; end if;
  if coalesce(trim(p_contenu), '') = '' then raise exception 'La réponse est vide.'; end if;
  select case when p.role::text = 'superviseur' then 'Administration Gestion IEPP' else p.nom_complet end as nom_complet,
         case when p.role::text = 'superviseur' then null else p.role::text end as role, i.nom as iepp into moi from profils p left join iepp i on i.id = p.iepp_id where p.id = auth.uid();
  insert into forum_reponses (sujet_id, contenu, auteur_id, auteur_nom, auteur_role, auteur_iepp)
  values (p_sujet, trim(p_contenu), auth.uid(), moi.nom_complet, moi.role, moi.iepp)
  returning id into v_id;
  insert into forum_vues (user_id, sujet_id) values (auth.uid(), p_sujet)
  on conflict (user_id, sujet_id) do update set vu_le = now();
  return v_id;
end $$;

-- 4. Messages et forum déjà écrits par le superviseur
update messages m set expediteur_nom = 'Administration Gestion IEPP'
  from profils p where p.id = m.expediteur_id and p.role::text = 'superviseur';
update forum_sujets s set auteur_nom = 'Administration Gestion IEPP', auteur_role = null, auteur_iepp = null
  from profils p where p.id = s.auteur_id and p.role::text = 'superviseur';
update forum_reponses r set auteur_nom = 'Administration Gestion IEPP', auteur_role = null, auteur_iepp = null
  from profils p where p.id = r.auteur_id and p.role::text = 'superviseur';

-- 5. Connexions : le superviseur voit tout le monde ; les autres ne le voient jamais
create or replace function presences()
returns table (
  id uuid, nom_complet text, role text, actif boolean,
  iepp_id uuid, iepp text, drena text, ecole text,
  derniere_activite timestamptz, derniere_connexion timestamptz
)
language sql stable security definer set search_path = public, auth as $$
  select p.id, p.nom_complet, p.role::text, p.actif,
         p.iepp_id, i.nom, d.nom, e.nom,
         p.derniere_activite, u.last_sign_in_at
    from profils p
    left join auth.users u on u.id = p.id
    left join iepp i on i.id = p.iepp_id
    left join drena d on d.id = i.drena_id
    left join ecoles e on e.id = p.ecole_id
   where est_superviseur()
      or (mon_role()::text = 'iepp' and p.iepp_id = mon_iepp() and p.role::text <> 'superviseur')
   order by p.derniere_activite desc nulls last, u.last_sign_in_at desc nulls last
$$;
grant execute on function presences() to authenticated;

notify pgrst, 'reload schema';
select 'Compte superviseur masqué pour les autres utilisateurs' as resultat;
