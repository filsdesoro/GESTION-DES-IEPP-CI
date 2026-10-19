-- =====================================================================
--  GESTION IEPP — Boutons « Supprimer » : élèves et personnel
--  À coller dans Supabase > SQL Editor > New query, puis Run.
-- =====================================================================

-- Supprimer un élève (son inscription, ses notes ; et sa fiche s'il n'a pas d'autre inscription)
create or replace function supprimer_eleve(p_inscription uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_eleve uuid; v_ecole uuid;
begin
  select i.eleve_id, c.ecole_id into v_eleve, v_ecole
    from inscriptions i join classes c on c.id = i.classe_id where i.id = p_inscription;
  if v_eleve is null then raise exception 'Élève introuvable.'; end if;
  if not peut_voir_ecole(v_ecole) or mon_role() = 'conseiller' then raise exception 'Action non autorisée.'; end if;
  delete from inscriptions where id = p_inscription;
  if not exists (select 1 from inscriptions where eleve_id = v_eleve) then
    delete from eleves where id = v_eleve;
  end if;
end $$;
grant execute on function supprimer_eleve(uuid) to authenticated;

-- Supprimer un agent (son affectation ; et sa fiche s'il n'a ni autre affectation ni compte)
create or replace function supprimer_agent(p_affectation uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pers uuid; v_iepp uuid;
begin
  select personnel_id, iepp_id into v_pers, v_iepp from affectations where id = p_affectation;
  if v_pers is null then raise exception 'Agent introuvable.'; end if;
  if not peut_gerer_iepp(v_iepp) then raise exception 'Action non autorisée.'; end if;
  delete from affectations where id = p_affectation;
  update secteurs set conseiller_id = null where conseiller_id = v_pers and not exists (select 1 from affectations where personnel_id = v_pers);
  if not exists (select 1 from affectations where personnel_id = v_pers)
     and not exists (select 1 from profils where personnel_id = v_pers) then
    delete from personnel where id = v_pers;
  end if;
end $$;
grant execute on function supprimer_agent(uuid) to authenticated;

notify pgrst, 'reload schema';
select 'Suppressions installées' as resultat;
