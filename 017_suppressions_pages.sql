-- =====================================================================
--  GESTION IEPP — Bouton Supprimer sur les autres pages
--   • Relevés de notes / Suivi de la saisie : supprimer les notes d'un élève
--     ou d'une classe pour une composition (moyennes et rangs recalculés).
--   • Convocations CEPE : retirer un candidat.
--   • Comptes utilisateurs : la suppression d'un compte devient récupérable.
--  Tout passe par la Corbeille (Annuler / Restaurer).
--  À lancer APRÈS 016_corbeille.sql. Peut être relancé sans risque.
-- =====================================================================

-- 1. Nouvelles tables suivies par la corbeille : candidats CEPE et profils des comptes
do $$
declare t text;
begin
  foreach t in array array['cepe_candidats', 'profils'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists vers_corbeille on %I', t);
      execute format('create trigger vers_corbeille before delete on %I for each row execute function vers_corbeille()', t);
    end if;
  end loop;
end $$;

-- 2. Restauration générale (gère aussi les comptes : tables auth.users / auth.identities)
create or replace function restaurer(p_groupe bigint)
returns integer language plpgsql security definer set search_path = public, auth as $$
declare
  r record; n integer := 0; reste bigint[]; progres boolean := true; derniere text;
  t regclass; cols text;
begin
  if not exists (select 1 from corbeille where groupe = p_groupe and (est_superviseur() or supprime_par = auth.uid())) then
    raise exception 'Élément introuvable dans la corbeille (ou déjà restauré).';
  end if;
  select array_agg(id order by id) into reste from corbeille where groupe = p_groupe;
  while progres and coalesce(array_length(reste, 1), 0) > 0 loop
    progres := false;
    for r in select * from corbeille where id = any(reste) order by id loop
      begin
        t := r.table_nom::regclass;
        select string_agg(quote_ident(attname), ', ' order by attnum) into cols
          from pg_attribute where attrelid = t and attnum > 0 and not attisdropped and attgenerated = '';
        execute format('insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1) on conflict do nothing',
                       t, cols, cols, t) using r.donnees;
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

  -- notes remises : on recalcule moyennes et rangs des classes concernées
  for r in select distinct (c.donnees->>'composition_id')::uuid as compo, i.classe_id
             from corbeille c join inscriptions i on i.id = (c.donnees->>'inscription_id')::uuid
            where c.groupe = p_groupe and c.table_nom = 'notes' loop
    begin perform calculer_resultats(r.compo, r.classe_id); exception when others then null; end;
  end loop;

  delete from corbeille where groupe = p_groupe;
  return n;
end $$;

-- 3. Supprimer les notes d'une composition : d'un élève (p_inscription) ou de toute la classe
create or replace function supprimer_notes(p_composition uuid, p_classe uuid, p_inscription uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not peut_voir_ecole((select ecole_id from classes where id = p_classe)) or mon_role()::text = 'conseiller' then
    raise exception 'Action non autorisée pour votre compte.';
  end if;
  delete from notes nt using inscriptions i
   where nt.composition_id = p_composition and nt.inscription_id = i.id and i.classe_id = p_classe
     and (p_inscription is null or i.id = p_inscription);
  get diagnostics n = row_count;
  perform calculer_resultats(p_composition, p_classe);
  return n;
end $$;
grant execute on function supprimer_notes(uuid, uuid, uuid) to authenticated;

-- 4. Suppression d'un compte : le compte de connexion est gardé dans la corbeille
create or replace function supprimer_compte(p_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_p profils%rowtype;
begin
  if p_id = auth.uid() then raise exception 'Vous ne pouvez pas supprimer votre propre compte.'; end if;
  select * into v_p from profils where id = p_id;
  if not found then raise exception 'Compte introuvable.'; end if;
  if not peut_gerer_compte(v_p.role, v_p.iepp_id) then raise exception 'Action non autorisée.'; end if;

  insert into corbeille (groupe, table_nom, donnees, libelle, supprime_par)
  select txid_current(), 'auth.users', to_jsonb(u), v_p.nom_complet, auth.uid() from auth.users u where u.id = p_id;
  insert into corbeille (groupe, table_nom, donnees, libelle, supprime_par)
  select txid_current(), 'auth.identities', to_jsonb(x), null, auth.uid() from auth.identities x where x.user_id = p_id;

  update public.journal set user_id = null where user_id = p_id;
  delete from auth.users where id = p_id;   -- le profil est supprimé en cascade (et copié dans la corbeille)
  insert into public.journal (user_id, action, table_cible, cible_id, details)
  values (auth.uid(), 'suppression_compte', 'profils', p_id, jsonb_build_object('role', v_p.role));
end $$;
revoke all on function supprimer_compte(uuid) from public, anon;
grant execute on function supprimer_compte(uuid) to authenticated;

notify pgrst, 'reload schema';
select 'Suppressions des pages installées' as resultat;
