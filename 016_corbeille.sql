-- =====================================================================
--  GESTION IEPP — Corbeille : annuler une suppression
--  Tout ce qui est supprimé (écoles, classes, élèves, notes, personnel,
--  secteurs, compositions, matières, abonnements…) est d'abord copié dans
--  la corbeille, avec les éléments liés supprimés en même temps
--  (ex. un élève + son inscription + ses notes).
--  À lancer APRÈS 015. Peut être relancé sans risque.
--  « Annuler » ou « Restaurer » remet tout en place.
--  Les éléments restent 60 jours dans la corbeille.
--  À coller dans Supabase > SQL Editor > New query, puis Run.
-- =====================================================================

create table if not exists corbeille (
  id            bigserial primary key,
  groupe        bigint not null,              -- une action de suppression = un groupe
  table_nom     text not null,
  donnees       jsonb not null,
  libelle       text,
  supprime_par  uuid default auth.uid(),
  supprime_le   timestamptz not null default now()
);
create index if not exists corbeille_groupe on corbeille (groupe);
create index if not exists corbeille_par on corbeille (supprime_par, supprime_le desc);

alter table corbeille enable row level security;
drop policy if exists corbeille_lecture on corbeille;
create policy corbeille_lecture on corbeille for select to authenticated
  using (est_superviseur() or supprime_par = auth.uid());
grant select on corbeille to authenticated;
grant usage, select on sequence corbeille_id_seq to authenticated;

-- Copie de la ligne supprimée
create or replace function vers_corbeille() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb := to_jsonb(old); lib text;
begin
  if tg_table_name = 'inscriptions' then
    select trim(nom || ' ' || coalesce(prenoms, '')) into lib from eleves where id = (d->>'eleve_id')::uuid;
  elsif tg_table_name = 'affectations' then
    select trim(nom || ' ' || coalesce(prenoms, '')) into lib from personnel where id = (d->>'personnel_id')::uuid;
  end if;
  insert into corbeille (groupe, table_nom, donnees, libelle, supprime_par)
  values (txid_current(), tg_table_name, d,
          coalesce(lib, nullif(trim(coalesce(d->>'nom', '') || ' ' || coalesce(d->>'prenoms', '')), ''),
                   d->>'libelle', d->>'nom_complet', d->>'reference', d->>'code'),
          auth.uid());
  return old;
end $$;

do $$
declare t text;
begin
  foreach t in array array['drena', 'iepp', 'secteurs', 'ecoles', 'annees_scolaires', 'classes', 'eleves', 'inscriptions',
                           'notes', 'personnel', 'affectations', 'compositions', 'matieres', 'abonnements',
                           'paiements_recus', 'cepe_centres', 'fiches_eps', 'emplois']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists vers_corbeille on %I', t);
      execute format('create trigger vers_corbeille before delete on %I for each row execute function vers_corbeille()', t);
    end if;
  end loop;
end $$;

-- Restaurer une action de suppression : on remet chaque ligne ; si une ligne dépend
-- d'une autre pas encore remise (ex. inscription avant l'élève), on réessaie au tour suivant.
create or replace function restaurer(p_groupe bigint)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; reste bigint[]; progres boolean := true; derniere text;
begin
  if not exists (select 1 from corbeille where groupe = p_groupe and (est_superviseur() or supprime_par = auth.uid())) then
    raise exception 'Élément introuvable dans la corbeille (ou déjà restauré).';
  end if;
  select array_agg(id order by id) into reste from corbeille where groupe = p_groupe;
  while progres and coalesce(array_length(reste, 1), 0) > 0 loop
    progres := false;
    for r in select * from corbeille where id = any(reste) order by id loop
      begin
        execute format('insert into %I select * from jsonb_populate_record(null::%I, $1) on conflict do nothing',
                       r.table_nom, r.table_nom) using r.donnees;
        reste := array_remove(reste, r.id);
        n := n + 1; progres := true;
      exception when others then
        derniere := r.table_nom || ' : ' || sqlerrm;
      end;
    end loop;
  end loop;
  if coalesce(array_length(reste, 1), 0) > 0 then
    raise exception 'Restauration impossible (%). Restaurez d''abord l''élément parent (école, classe…).', derniere;
  end if;
  delete from corbeille where groupe = p_groupe;
  return n;
end $$;

-- Annuler la dernière suppression de l'utilisateur
create or replace function annuler_derniere_suppression()
returns integer language plpgsql security definer set search_path = public as $$
declare g bigint;
begin
  select groupe into g from corbeille where supprime_par = auth.uid() order by id desc limit 1;
  if g is null then raise exception 'Aucune suppression à annuler.'; end if;
  return restaurer(g);
end $$;

-- Vider la corbeille (superviseur) ; nettoyage automatique après 60 jours
create or replace function vider_corbeille(p_groupe bigint default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not est_superviseur() then raise exception 'Réservé au superviseur.'; end if;
  if p_groupe is null then delete from corbeille; else delete from corbeille where groupe = p_groupe; end if;
end $$;

create or replace function nettoyer_corbeille() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from corbeille where supprime_le < now() - interval '60 days';
  return null;
end $$;
drop trigger if exists nettoyer_corbeille on corbeille;
create trigger nettoyer_corbeille after insert on corbeille for each statement execute function nettoyer_corbeille();

-- Liste par action de suppression (pour la page Corbeille)
create or replace function corbeille_liste()
returns table (groupe bigint, libelle text, table_nom text, nb integer, supprime_le timestamptz, supprime_par text)
language sql stable security definer set search_path = public as $$
  select c.groupe,
         (array_agg(c.libelle order by c.libelle is null, c.id))[1],
         (array_agg(c.table_nom order by c.table_nom = 'notes', c.id))[1],
         count(*)::int, max(c.supprime_le),
         coalesce(max(p.nom_complet), '—')
    from corbeille c left join profils p on p.id = c.supprime_par
   where est_superviseur() or c.supprime_par = auth.uid()
   group by c.groupe
   order by max(c.supprime_le) desc
   limit 500
$$;

grant execute on function corbeille_liste(), restaurer(bigint), annuler_derniere_suppression(), vider_corbeille(bigint) to authenticated;

notify pgrst, 'reload schema';
select 'Corbeille installée' as resultat;
