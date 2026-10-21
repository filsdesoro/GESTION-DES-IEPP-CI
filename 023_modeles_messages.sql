-- =====================================================================
--  GESTION IEPP — Messages prédéfinis (modèles)
--  En plus des modèles fournis avec le logiciel, chacun peut enregistrer
--  ses propres modèles. L'inspecteur peut partager un modèle avec toute
--  sa circonscription ; le superviseur avec tout le monde.
--  À coller dans Supabase > SQL Editor > New query, puis Run.
-- =====================================================================

create table if not exists modeles_messages (
  id         uuid primary key default gen_random_uuid(),
  auteur_id  uuid references profils(id) on delete cascade,
  portee     text not null default 'moi' check (portee in ('moi', 'circ', 'tous')),
  iepp_id    uuid references iepp(id) on delete cascade,
  titre      text not null,
  objet      text not null default '',
  corps      text not null,
  created_at timestamptz not null default now()
);
create index if not exists modeles_auteur on modeles_messages (auteur_id);

alter table modeles_messages enable row level security;
drop policy if exists modeles_lecture on modeles_messages;
create policy modeles_lecture on modeles_messages for select to authenticated using (
  auteur_id = auth.uid()
  or portee = 'tous'
  or (portee = 'circ' and iepp_id = mon_iepp())
  or est_superviseur()
);
drop policy if exists modeles_ecriture on modeles_messages;
create policy modeles_ecriture on modeles_messages for all to authenticated
  using (auteur_id = auth.uid() or est_superviseur())
  with check (
    (auteur_id = auth.uid() or est_superviseur())
    and (portee = 'moi'
         or (portee = 'circ' and mon_role()::text in ('iepp', 'superviseur') and iepp_id is not null)
         or (portee = 'tous' and est_superviseur()))
  );
grant select, insert, update, delete on modeles_messages to authenticated;

notify pgrst, 'reload schema';
select 'Messages prédéfinis installés' as resultat;
