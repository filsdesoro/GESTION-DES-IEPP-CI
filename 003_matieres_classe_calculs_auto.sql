-- =====================================================================
--  GESTION IEPP — Matières choisies par l'enseignant + calculs automatiques
--  (total, moyenne, rang, appréciation, moyenne annuelle, décision)
--  À coller dans Supabase > SQL Editor > New query, puis Run.
--  Peut être relancé sans risque.
-- =====================================================================

-- 1. Les enseignants (directeur, agent de saisie, inspecteur) peuvent ajouter
--    une matière au catalogue ; seul le superviseur peut la modifier/supprimer.
drop policy if exists matieres_ajout on matieres;
create policy matieres_ajout on matieres for insert to authenticated
  with check (mon_role() is not null);

-- 2. Matières propres à une classe (choisies par l'enseignant)
create table if not exists matieres_classe (
  classe_id   uuid not null references classes(id) on delete cascade,
  matiere_id  uuid not null references matieres(id) on delete cascade,
  note_sur    numeric(5,2) not null default 10 check (note_sur > 0),
  coefficient numeric(4,2) not null default 1 check (coefficient > 0),
  ordre       smallint not null default 0,
  primary key (classe_id, matiere_id)
);
alter table matieres_classe enable row level security;
drop policy if exists matieres_classe_lecture on matieres_classe;
drop policy if exists matieres_classe_ecriture on matieres_classe;
create policy matieres_classe_lecture on matieres_classe for select to authenticated
  using (peut_voir_ecole((select ecole_id from classes c where c.id = classe_id)));
create policy matieres_classe_ecriture on matieres_classe for all to authenticated
  using (peut_voir_ecole((select ecole_id from classes c where c.id = classe_id)) and mon_role() <> 'conseiller')
  with check (peut_voir_ecole((select ecole_id from classes c where c.id = classe_id)) and mon_role() <> 'conseiller');
grant all on matieres_classe to authenticated, service_role;

-- 3. Seuil de passage propre à chaque circonscription (moyenne sur 10)
alter table iepp add column if not exists seuil_passage numeric(4,2) not null default 5;

-- 4. Barème effectif d'une classe : ses matières propres, sinon le barème du niveau
create or replace function bareme_classe(p_classe uuid)
returns table (matiere_id uuid, note_sur numeric, coefficient numeric)
language sql stable security definer set search_path = public as $$
  select mc.matiere_id, mc.note_sur, mc.coefficient
    from matieres_classe mc where mc.classe_id = p_classe
  union all
  select mn.matiere_id, mn.note_sur, mn.coefficient
    from matieres_niveaux mn join classes c on c.id = p_classe and mn.niveau_code = c.niveau_code
   where not exists (select 1 from matieres_classe x where x.classe_id = p_classe)
$$;

-- 5. Appréciation selon la moyenne sur 10
create or replace function appreciation_moyenne(m numeric) returns text
language sql immutable as $$
  select case
    when m is null then null
    when m >= 9 then 'Excellent'
    when m >= 8 then 'Très bien'
    when m >= 7 then 'Bien'
    when m >= 6 then 'Assez bien'
    when m >= 5 then 'Passable'
    when m >= 4 then 'Insuffisant'
    else 'Très insuffisant' end
$$;

-- 6. Bilan annuel automatique d'une classe : moyenne annuelle (compositions
--    mensuelles), rang, décision admis / redouble selon le seuil de l'IEPP.
--    Les décisions saisies à la main (abandon, exclu, transféré) sont conservées.
create or replace function calculer_bilan_classe(p_classe uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_seuil numeric; v_annee uuid; v_iepp uuid;
begin
  if not peut_voir_ecole((select ecole_id from classes where id = p_classe)) then
    raise exception 'Accès refusé à cette classe';
  end if;
  select c.annee_id, e.iepp_id, i.seuil_passage into v_annee, v_iepp, v_seuil
    from classes c join ecoles e on e.id = c.ecole_id join iepp i on i.id = e.iepp_id
   where c.id = p_classe;

  with moy as (
    select ins.id,
           round(avg(r.moyenne), 2) as ma
      from inscriptions ins
      left join (select r.inscription_id, r.moyenne
                   from resultats_composition r
                   join compositions k on k.id = r.composition_id
                  where k.type in ('mensuelle', 'autre') and k.annee_id = v_annee and k.iepp_id = v_iepp) r
             on r.inscription_id = ins.id
     where ins.classe_id = p_classe
     group by ins.id
  ), rangs as (
    select id, ma, case when ma is null then null else rank() over (order by ma desc nulls last) end as rg from moy
  )
  update inscriptions ins
     set moyenne_annuelle = rangs.ma,
         rang_annuel = rangs.rg,
         decision = case
           when ins.decision in ('abandon', 'exclu', 'transfere') then ins.decision
           when rangs.ma is null then null
           when rangs.ma >= coalesce(v_seuil, 5) then 'admis'::decision_fin
           else 'redouble'::decision_fin end
    from rangs
   where ins.id = rangs.id;
end $$;

-- 7. Résultats d'une composition pour une classe : total, moyenne, rang,
--    appréciation, puis mise à jour automatique du bilan annuel.
create or replace function calculer_resultats(p_composition uuid, p_classe uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not peut_voir_ecole((select ecole_id from classes where id = p_classe)) then
    raise exception 'Accès refusé à cette classe';
  end if;

  delete from resultats_composition r
   using inscriptions i
   where r.composition_id = p_composition and r.inscription_id = i.id and i.classe_id = p_classe;

  insert into resultats_composition (composition_id, inscription_id, total_points, moyenne, rang, appreciation)
  select p_composition, x.inscription_id, x.total, x.moyenne,
         case when x.moyenne is null then null else rank() over (order by x.moyenne desc nulls last) end,
         appreciation_moyenne(x.moyenne)
  from (
    select i.id as inscription_id,
           sum(n.note * b.coefficient)                                   as total,
           round(sum(n.note / b.note_sur * 10 * b.coefficient)
                 / nullif(sum(b.coefficient), 0), 2)                     as moyenne
    from inscriptions i
    left join notes n on n.inscription_id = i.id and n.composition_id = p_composition
                     and not n.absent and n.note is not null
    left join bareme_classe(p_classe) b on b.matiere_id = n.matiere_id
    where i.classe_id = p_classe
    group by i.id
  ) x;

  perform calculer_bilan_classe(p_classe);
end $$;

grant execute on function bareme_classe(uuid), appreciation_moyenne(numeric),
  calculer_bilan_classe(uuid), calculer_resultats(uuid, uuid) to authenticated;

-- 8. Le suivi de la saisie tient compte des matières propres à chaque classe
create or replace view v_suivi_saisie with (security_invoker = true) as
select k.id as composition_id, k.libelle as composition,
       e.iepp_id, e.secteur_id, e.id as ecole_id, e.nom as ecole,
       c.id as classe_id, c.nom as classe, c.niveau_code,
       count(distinct i.id)                                          as nb_eleves,
       (select count(*) from bareme_classe(c.id))                    as nb_matieres,
       count(n.id)                                                   as nb_notes_saisies,
       round(100.0 * count(n.id) / nullif(count(distinct i.id) *
             (select count(*) from bareme_classe(c.id)), 0), 1)      as taux_saisie
from compositions k
join ecoles e  on e.iepp_id = k.iepp_id
join classes c on c.ecole_id = e.id and c.annee_id = k.annee_id and c.niveau_code = any(k.niveaux)
join inscriptions i on i.classe_id = c.id
left join notes n on n.inscription_id = i.id and n.composition_id = k.id
                 and (n.note is not null or n.absent)
group by k.id, k.libelle, e.iepp_id, e.secteur_id, e.id, e.nom, c.id, c.nom, c.niveau_code;

select 'Installation terminée' as resultat;
