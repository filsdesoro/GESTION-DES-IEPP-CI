-- =====================================================================
--  GESTION IEPP — Forum
--   • Forum INTER-IEPP : les inspecteurs de toutes les circonscriptions
--     et le superviseur échangent entre eux.
--   • Forum de la CIRCONSCRIPTION : tous les utilisateurs d'une IEPP
--     (inspecteur, conseillers, directeurs, agents de saisie, enseignants).
--  Sujets classés par catégorie, réponses, sujets épinglés / fermés,
--  modération (superviseur partout, inspecteur dans sa circonscription).
--  À coller dans Supabase > SQL Editor > New query, puis Run.
-- =====================================================================

create table if not exists forum_sujets (
  id               uuid primary key default gen_random_uuid(),
  espace           text not null check (espace in ('inter', 'circ')),
  iepp_id          uuid references iepp(id) on delete cascade,
  categorie        text not null default 'Divers',
  titre            text not null,
  contenu          text not null,
  auteur_id        uuid references profils(id) on delete set null,
  auteur_nom       text,
  auteur_role      text,
  auteur_iepp      text,
  epingle          boolean not null default false,
  verrouille       boolean not null default false,
  nb_reponses      integer not null default 0,
  derniere_activite timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  modifie_le       timestamptz,
  check ((espace = 'inter' and iepp_id is null) or (espace = 'circ' and iepp_id is not null))
);
create table if not exists forum_reponses (
  id          uuid primary key default gen_random_uuid(),
  sujet_id    uuid not null references forum_sujets(id) on delete cascade,
  contenu     text not null,
  auteur_id   uuid references profils(id) on delete set null,
  auteur_nom  text,
  auteur_role text,
  auteur_iepp text,
  created_at  timestamptz not null default now(),
  modifie_le  timestamptz
);
create table if not exists forum_vues (
  user_id  uuid not null references profils(id) on delete cascade,
  sujet_id uuid not null references forum_sujets(id) on delete cascade,
  vu_le    timestamptz not null default now(),
  primary key (user_id, sujet_id)
);
create index if not exists forum_sujets_espace on forum_sujets (espace, iepp_id, derniere_activite desc);
create index if not exists forum_reponses_sujet on forum_reponses (sujet_id, created_at);

-- Droits
create or replace function forum_peut_lire(p_espace text, p_iepp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profils p where p.id = auth.uid() and p.actif and (
         p.role::text = 'superviseur'
      or (p_espace = 'inter' and p.role::text = 'iepp')
      or (p_espace = 'circ' and p.iepp_id = p_iepp)
    )
  )
$$;
create or replace function forum_peut_moderer(p_espace text, p_iepp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profils p where p.id = auth.uid() and p.actif and (
         p.role::text = 'superviseur'
      or (p_espace = 'circ' and p.role::text = 'iepp' and p.iepp_id = p_iepp)
    )
  )
$$;
create or replace function forum_sujet_lisible(p_sujet uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from forum_sujets s where s.id = p_sujet and forum_peut_lire(s.espace, s.iepp_id))
$$;
create or replace function forum_sujet_moderable(p_sujet uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from forum_sujets s where s.id = p_sujet and forum_peut_moderer(s.espace, s.iepp_id))
$$;

alter table forum_sujets enable row level security;
alter table forum_reponses enable row level security;
alter table forum_vues enable row level security;

drop policy if exists sujets_lecture on forum_sujets;
create policy sujets_lecture on forum_sujets for select to authenticated using (forum_peut_lire(espace, iepp_id));
drop policy if exists sujets_maj on forum_sujets;
create policy sujets_maj on forum_sujets for update to authenticated
  using (auteur_id = auth.uid() or forum_peut_moderer(espace, iepp_id))
  with check (auteur_id = auth.uid() or forum_peut_moderer(espace, iepp_id));
drop policy if exists sujets_suppr on forum_sujets;
create policy sujets_suppr on forum_sujets for delete to authenticated
  using (auteur_id = auth.uid() or forum_peut_moderer(espace, iepp_id));

drop policy if exists reponses_lecture on forum_reponses;
create policy reponses_lecture on forum_reponses for select to authenticated using (forum_sujet_lisible(sujet_id));
drop policy if exists reponses_maj on forum_reponses;
create policy reponses_maj on forum_reponses for update to authenticated
  using (auteur_id = auth.uid() or forum_sujet_moderable(sujet_id))
  with check (auteur_id = auth.uid() or forum_sujet_moderable(sujet_id));
drop policy if exists reponses_suppr on forum_reponses;
create policy reponses_suppr on forum_reponses for delete to authenticated
  using (auteur_id = auth.uid() or forum_sujet_moderable(sujet_id));

drop policy if exists vues_moi on forum_vues;
create policy vues_moi on forum_vues for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, update, delete on forum_sujets, forum_reponses to authenticated;
grant select, insert, update, delete on forum_vues to authenticated;

-- Seul un modérateur peut épingler / fermer un sujet
create or replace function forum_controle_moderation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.epingle is distinct from old.epingle or new.verrouille is distinct from old.verrouille)
     and not forum_peut_moderer(old.espace, old.iepp_id) then
    raise exception 'Seul un modérateur peut épingler ou fermer un sujet.';
  end if;
  new.espace := old.espace; new.iepp_id := old.iepp_id; new.auteur_id := old.auteur_id;
  return new;
end $$;
drop trigger if exists forum_controle_moderation on forum_sujets;
create trigger forum_controle_moderation before update on forum_sujets for each row execute function forum_controle_moderation();

-- Compteur de réponses et date de dernière activité
create or replace function forum_compter() returns trigger
language plpgsql security definer set search_path = public as $$
declare s uuid := coalesce(new.sujet_id, old.sujet_id);
begin
  update forum_sujets set
    nb_reponses = (select count(*) from forum_reponses where sujet_id = s),
    derniere_activite = greatest(created_at, coalesce((select max(created_at) from forum_reponses where sujet_id = s), created_at))
  where id = s;
  return null;
end $$;
drop trigger if exists forum_compter on forum_reponses;
create trigger forum_compter after insert or delete on forum_reponses for each row execute function forum_compter();

-- Création d'un sujet
create or replace function forum_creer_sujet(p_espace text, p_iepp uuid, p_categorie text, p_titre text, p_contenu text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_iepp uuid := case when p_espace = 'circ' then p_iepp end; moi record;
begin
  if not forum_peut_lire(p_espace, v_iepp) then raise exception 'Vous n''avez pas accès à ce forum.'; end if;
  if coalesce(trim(p_titre), '') = '' or coalesce(trim(p_contenu), '') = '' then raise exception 'Indiquez un titre et un message.'; end if;
  select p.nom_complet, p.role::text as role, i.nom as iepp into moi from profils p left join iepp i on i.id = p.iepp_id where p.id = auth.uid();
  insert into forum_sujets (espace, iepp_id, categorie, titre, contenu, auteur_id, auteur_nom, auteur_role, auteur_iepp)
  values (p_espace, v_iepp, coalesce(nullif(trim(p_categorie), ''), 'Divers'), trim(p_titre), trim(p_contenu), auth.uid(), moi.nom_complet, moi.role, moi.iepp)
  returning id into v_id;
  insert into forum_vues (user_id, sujet_id) values (auth.uid(), v_id) on conflict do nothing;
  return v_id;
end $$;

-- Réponse à un sujet
create or replace function forum_repondre(p_sujet uuid, p_contenu text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; s forum_sujets%rowtype; moi record;
begin
  select * into s from forum_sujets where id = p_sujet;
  if not found or not forum_peut_lire(s.espace, s.iepp_id) then raise exception 'Sujet introuvable.'; end if;
  if s.verrouille and not forum_peut_moderer(s.espace, s.iepp_id) then raise exception 'Ce sujet est fermé : on ne peut plus y répondre.'; end if;
  if coalesce(trim(p_contenu), '') = '' then raise exception 'La réponse est vide.'; end if;
  select p.nom_complet, p.role::text as role, i.nom as iepp into moi from profils p left join iepp i on i.id = p.iepp_id where p.id = auth.uid();
  insert into forum_reponses (sujet_id, contenu, auteur_id, auteur_nom, auteur_role, auteur_iepp)
  values (p_sujet, trim(p_contenu), auth.uid(), moi.nom_complet, moi.role, moi.iepp)
  returning id into v_id;
  insert into forum_vues (user_id, sujet_id) values (auth.uid(), p_sujet)
  on conflict (user_id, sujet_id) do update set vu_le = now();
  return v_id;
end $$;

-- Sujets avec du nouveau depuis ma dernière visite (pour le menu)
create or replace function forum_nouveautes() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from forum_sujets s
   left join forum_vues v on v.sujet_id = s.id and v.user_id = auth.uid()
   where forum_peut_lire(s.espace, s.iepp_id)
     and (v.vu_le is null or s.derniere_activite > v.vu_le)
     and s.auteur_id is distinct from auth.uid()
     and s.derniere_activite > now() - interval '30 days'
$$;

grant execute on function forum_peut_lire(text, uuid), forum_peut_moderer(text, uuid), forum_sujet_lisible(uuid), forum_sujet_moderable(uuid),
  forum_creer_sujet(text, uuid, text, text, text), forum_repondre(uuid, text), forum_nouveautes() to authenticated;

-- Les messages supprimés du forum passent par la corbeille (si elle est installée)
do $$
declare t text;
begin
  if to_regprocedure('public.vers_corbeille()') is not null then
    foreach t in array array['forum_sujets', 'forum_reponses'] loop
      execute format('drop trigger if exists vers_corbeille on %I', t);
      execute format('create trigger vers_corbeille before delete on %I for each row execute function vers_corbeille()', t);
    end loop;
  end if;
  if to_regclass('public.acces_roles') is not null then
    update acces_roles set rubriques = array_prepend('/forum', rubriques)
     where role = 'enseignant' and not ('/forum' = any(rubriques));
  end if;
end $$;

notify pgrst, 'reload schema';
select 'Forum installé' as resultat;
