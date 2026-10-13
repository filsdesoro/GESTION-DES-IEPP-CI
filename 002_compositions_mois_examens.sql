-- =====================================================================
--  GESTION IEPP — Compositions mensuelles et examens blancs (max 3)
--  À coller dans Supabase > SQL Editor > New query, puis Run.
--  Peut être relancé sans risque.
-- =====================================================================

-- Type de composition, mois et numéro d'examen blanc
alter table compositions add column if not exists type text not null default 'mensuelle';
alter table compositions add column if not exists mois smallint;
alter table compositions add column if not exists numero smallint;

-- Les compositions déjà créées (s'il y en a) deviennent « autre »
update compositions set type = 'autre' where type = 'mensuelle' and mois is null;

do $$ begin
  alter table compositions add constraint compositions_type_chk
    check (type in ('mensuelle', 'examen_blanc', 'autre'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table compositions add constraint compositions_mois_chk
    check (mois is null or mois between 1 and 12);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table compositions add constraint compositions_coherence_chk check (
       (type = 'mensuelle'    and mois is not null)
    or (type = 'examen_blanc' and numero between 1 and 3)
    or (type = 'autre')
  );
exception when duplicate_object then null; end $$;

-- Une seule composition par mois, et un seul examen blanc n°1, n°2, n°3
-- par circonscription et par année
create unique index if not exists compositions_mois_unique
  on compositions (iepp_id, annee_id, mois) where type = 'mensuelle';
create unique index if not exists compositions_examen_unique
  on compositions (iepp_id, annee_id, numero) where type = 'examen_blanc';

-- Garde-fou : 3 examens blancs au maximum par circonscription et par année
create or replace function limiter_examens_blancs() returns trigger
language plpgsql as $$
begin
  if new.type = 'examen_blanc' and (
    select count(*) from compositions
     where iepp_id = new.iepp_id and annee_id = new.annee_id
       and type = 'examen_blanc' and id <> new.id
  ) >= 3 then
    raise exception 'Maximum 3 examens blancs par année pour cette circonscription.';
  end if;
  return new;
end $$;

drop trigger if exists t_limiter_examens_blancs on compositions;
create trigger t_limiter_examens_blancs
  before insert or update on compositions
  for each row execute function limiter_examens_blancs();

-- Contrôle
select type, count(*) from compositions group by type;
