-- =====================================================================
--  GESTION IEPP — Liens automatiques entre les rubriques
--  Chaque enregistrement va se loger dans la partie concernée :
--   1. Comptes → Personnel : un compte (inscription ou créé par l'inspecteur)
--      crée/complète la fiche Personnel et son affectation de l'année :
--        inspecteur → Chef de circonscription (bureau IEPP)
--        conseiller → Conseiller pédagogique + conseiller du secteur
--        directeur  → Directeur d'école de son école
--        agent de saisie → Secrétaire de son école
--   2. Maître de classe → Personnel : affecté à l'école comme « Maître de classe ».
--   3. Conseiller d'un secteur → Personnel : affecté comme conseiller pédagogique.
--   4. Directeur → École : visible dans Écoles, la fiche école, l'Annuaire
--      et les relevés de notes (côté logiciel).
--  À lancer APRÈS 008. Peut être relancé sans risque.
-- =====================================================================

alter table profils add column if not exists telephone text;

-- Affecter (ou ré-affecter) un agent pour l'année active, sans écraser une fonction de direction
create or replace function affecter_agent(p_personnel uuid, p_iepp uuid, p_ecole uuid, p_fonction text, p_annee uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_annee uuid := coalesce(p_annee, (select id from annees_scolaires where active limit 1));
begin
  if p_personnel is null or p_iepp is null or v_annee is null then return; end if;
  insert into affectations (personnel_id, annee_id, iepp_id, ecole_id, fonction_code)
  values (p_personnel, v_annee, p_iepp, p_ecole, p_fonction)
  on conflict (personnel_id, annee_id) do update set
    iepp_id = excluded.iepp_id,
    ecole_id = coalesce(excluded.ecole_id, affectations.ecole_id),
    fonction_code = case
      -- un directeur qui tient une classe reste directeur
      when affectations.fonction_code in ('DIR_DECH', 'DIR_CLASSE') and excluded.fonction_code = 'MAITRE' then affectations.fonction_code
      -- « directeur » sans précision : on garde « déchargé » s'il était déjà indiqué
      when affectations.fonction_code = 'DIR_DECH' and excluded.fonction_code = 'DIR_CLASSE' then 'DIR_DECH'
      else coalesce(excluded.fonction_code, affectations.fonction_code)
    end;
end $$;

-- 1. Comptes → Personnel (avant enregistrement du profil : on crée la fiche si besoin)
create or replace function profil_vers_personnel() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_nom      text := upper(split_part(trim(new.nom_complet), ' ', 1));
  v_prenoms  text := nullif(trim(substr(trim(new.nom_complet), length(split_part(trim(new.nom_complet), ' ', 1)) + 1)), '');
  v_fonction text;
begin
  if new.role = 'superviseur' or new.iepp_id is null then return new; end if;
  if new.personnel_id is null then
    -- fiche déjà existante dans la circonscription (même nom complet ou même téléphone) ?
    select pe.id into new.personnel_id
      from personnel pe
      left join affectations a on a.personnel_id = pe.id
     where (a.iepp_id = new.iepp_id or a.iepp_id is null)
       and (upper(trim(pe.nom || ' ' || pe.prenoms)) = upper(trim(new.nom_complet))
            or (new.telephone is not null and regexp_replace(coalesce(pe.telephone, ''), '[^0-9]', '', 'g') = regexp_replace(new.telephone, '[^0-9]', '', 'g')))
       and not exists (select 1 from profils x where x.personnel_id = pe.id and x.id <> new.id)
     limit 1;
  end if;
  if new.personnel_id is null then
    insert into personnel (nom, prenoms, telephone)
    values (v_nom, coalesce(v_prenoms, '-'), new.telephone)
    returning id into new.personnel_id;
  else
    update personnel set telephone = coalesce(personnel.telephone, new.telephone) where id = new.personnel_id;
  end if;
  v_fonction := case new.role
    when 'iepp' then 'CHEF_CIRC'
    when 'conseiller' then 'CP_SECT'
    when 'directeur' then 'DIR_CLASSE'
    when 'saisie' then 'SECR'
  end;
  perform affecter_agent(new.personnel_id, new.iepp_id,
    case when new.role in ('directeur', 'saisie') then new.ecole_id end, v_fonction);
  if new.role = 'conseiller' and new.secteur_id is not null then
    update secteurs set conseiller_id = new.personnel_id
     where id = new.secteur_id and conseiller_id is distinct from new.personnel_id;
  end if;
  return new;
end $$;
drop trigger if exists profil_vers_personnel on profils;
create trigger profil_vers_personnel before insert or update of nom_complet, role, iepp_id, secteur_id, ecole_id, telephone, personnel_id on profils
  for each row execute function profil_vers_personnel();

-- 2. Maître de classe → Personnel
create or replace function maitre_vers_personnel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.maitre_id is not null then
    perform affecter_agent(new.maitre_id, (select iepp_id from ecoles where id = new.ecole_id), new.ecole_id, 'MAITRE', new.annee_id);
  end if;
  return new;
end $$;
drop trigger if exists maitre_vers_personnel on classes;
create trigger maitre_vers_personnel after insert or update of maitre_id on classes
  for each row execute function maitre_vers_personnel();

-- 3. Conseiller d'un secteur → Personnel
create or replace function conseiller_vers_personnel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.conseiller_id is not null then
    perform affecter_agent(new.conseiller_id, new.iepp_id, null, 'CP_SECT');
  end if;
  return new;
end $$;
drop trigger if exists conseiller_vers_personnel on secteurs;
create trigger conseiller_vers_personnel after insert or update of conseiller_id on secteurs
  for each row execute function conseiller_vers_personnel();

-- Mise à jour des données déjà enregistrées
update profils set nom_complet = nom_complet where role <> 'superviseur' and iepp_id is not null;
update classes c set maitre_id = maitre_id
  from annees_scolaires a where a.id = c.annee_id and a.active and c.maitre_id is not null;
update secteurs set conseiller_id = conseiller_id where conseiller_id is not null;

notify pgrst, 'reload schema';
select 'Liens automatiques installés' as resultat;
