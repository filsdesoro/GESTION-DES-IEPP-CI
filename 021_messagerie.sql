-- =====================================================================
--  GESTION IEPP — Messagerie interne
--  Les utilisateurs s'envoient des messages à l'intérieur du logiciel :
--   • l'inspecteur écrit aux autres inspecteurs, au superviseur et à tous
--     les utilisateurs de sa circonscription (conseillers, directeurs…) ;
--   • les autres utilisateurs écrivent aux personnes de leur circonscription
--     et au superviseur ;
--   • le superviseur écrit à tout le monde.
--  Pièce par pièce : réponse, lu / non lu, suppression de sa boîte.
--  À coller dans Supabase > SQL Editor > New query, puis Run.
-- =====================================================================

-- Colonne téléphone des comptes (au cas où le script 012 n'a pas été lancé)
alter table profils add column if not exists telephone text;

create table if not exists messages (
  id           uuid primary key default gen_random_uuid(),
  expediteur_id uuid references profils(id) on delete set null,
  expediteur_nom text,
  objet        text not null,
  corps        text not null,
  reponse_a    uuid references messages(id) on delete set null,
  supprime_expediteur boolean not null default false,
  created_at   timestamptz not null default now()
);
create table if not exists message_destinataires (
  message_id     uuid not null references messages(id) on delete cascade,
  destinataire_id uuid not null references profils(id) on delete cascade,
  lu_le          timestamptz,
  supprime       boolean not null default false,
  primary key (message_id, destinataire_id)
);
create index if not exists message_dest_moi on message_destinataires (destinataire_id, supprime);
create index if not exists messages_exp on messages (expediteur_id, created_at desc);

-- Fonctions d'accès (évitent une boucle entre les règles des deux tables)
create or replace function suis_destinataire(p_message uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from message_destinataires where message_id = p_message and destinataire_id = auth.uid())
$$;
create or replace function suis_expediteur(p_message uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from messages where id = p_message and expediteur_id = auth.uid())
$$;

alter table messages enable row level security;
alter table message_destinataires enable row level security;
drop policy if exists messages_lecture on messages;
create policy messages_lecture on messages for select to authenticated using (
  expediteur_id = auth.uid()
  or suis_destinataire(id)
);
drop policy if exists messages_maj_exp on messages;
create policy messages_maj_exp on messages for update to authenticated
  using (expediteur_id = auth.uid()) with check (expediteur_id = auth.uid());
drop policy if exists dest_lecture on message_destinataires;
create policy dest_lecture on message_destinataires for select to authenticated using (
  destinataire_id = auth.uid()
  or suis_expediteur(message_id)
);
drop policy if exists dest_maj on message_destinataires;
create policy dest_maj on message_destinataires for update to authenticated
  using (destinataire_id = auth.uid()) with check (destinataire_id = auth.uid());
grant select, update on messages, message_destinataires to authenticated;

-- Peut-on écrire à cette personne ?
create or replace function peut_ecrire_a(p_dest uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profils moi, profils d
     where moi.id = auth.uid() and moi.actif and d.id = p_dest and d.actif and d.id <> moi.id
       and (
            moi.role::text = 'superviseur'
         or d.role::text = 'superviseur'
         or (moi.iepp_id is not null and d.iepp_id = moi.iepp_id)
         or (moi.role::text = 'iepp' and d.role::text = 'iepp')
       )
  )
$$;

-- Carnet d'adresses : personnes à qui j'ai le droit d'écrire
create or replace function destinataires_possibles()
returns table (id uuid, nom_complet text, role text, iepp_id uuid, iepp text, drena text,
               ecole text, telephone text, email text)
language sql stable security definer set search_path = public, auth as $$
  select p.id, p.nom_complet, p.role::text, p.iepp_id, i.nom, dr.nom, e.nom,
         coalesce(nullif(p.telephone, ''),
                  case when u.email like '%@tel.gestion-iepp.ci' then split_part(u.email, '@', 1) end),
         case when u.email not like '%@tel.gestion-iepp.ci' and u.email not like '%@mat.gestion-iepp.ci' then u.email::text end
    from profils p
    join auth.users u on u.id = p.id
    left join iepp i on i.id = p.iepp_id
    left join drena dr on dr.id = i.drena_id
    left join ecoles e on e.id = p.ecole_id
   where peut_ecrire_a(p.id)
   order by i.nom nulls first, p.nom_complet
$$;

-- Envoi d'un message à une ou plusieurs personnes
create or replace function envoyer_message(p_objet text, p_corps text, p_destinataires uuid[], p_reponse_a uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_nb integer;
begin
  if coalesce(trim(p_objet), '') = '' then raise exception 'Indiquez l''objet du message.'; end if;
  if coalesce(trim(p_corps), '') = '' then raise exception 'Le message est vide.'; end if;
  select count(*) into v_nb from unnest(p_destinataires) x where peut_ecrire_a(x);
  if v_nb = 0 then raise exception 'Choisissez au moins un destinataire.'; end if;
  insert into messages (expediteur_id, expediteur_nom, objet, corps, reponse_a)
  values (auth.uid(), (select nom_complet from profils where id = auth.uid()), trim(p_objet), trim(p_corps), p_reponse_a)
  returning id into v_id;
  insert into message_destinataires (message_id, destinataire_id)
  select distinct v_id, x from unnest(p_destinataires) x where peut_ecrire_a(x);
  return v_id;
end $$;

-- Nombre de messages non lus (pour le menu)
create or replace function messages_non_lus() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from message_destinataires where destinataire_id = auth.uid() and lu_le is null and not supprime
$$;

grant execute on function suis_destinataire(uuid), suis_expediteur(uuid), peut_ecrire_a(uuid), destinataires_possibles(), envoyer_message(text, text, uuid[], uuid), messages_non_lus() to authenticated;

-- Les enseignants ont aussi accès à la messagerie
do $$ begin
  if to_regclass('public.acces_roles') is not null then
    update acces_roles set rubriques = array_prepend('/messagerie', rubriques)
     where role = 'enseignant' and not ('/messagerie' = any(rubriques));
  end if;
end $$;

notify pgrst, 'reload schema';
select 'Messagerie installée' as resultat;
