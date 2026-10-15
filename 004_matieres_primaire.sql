-- =====================================================================
--  GESTION IEPP — Matières supplémentaires du primaire et du préscolaire
--  (Lecture, Écriture, Chant, Dessin, Récitation…)
--  À coller dans Supabase > SQL Editor > New query, puis Run.
--  Peut être relancé sans risque (les matières déjà présentes sont ignorées).
-- =====================================================================

insert into matieres (code, libelle, ordre)
select v.code, v.libelle, v.ordre from (values
  ('LECT',     'Lecture',                    11),
  ('ECRIT',    'Écriture',                   12),
  ('CALCUL',   'Calcul',                     13),
  ('GRAMM',    'Grammaire',                  14),
  ('CONJ',     'Conjugaison',                15),
  ('VOCAB',    'Vocabulaire',                16),
  ('RECIT',    'Récitation',                 17),
  ('LANGAGE',  'Langage / Expression orale', 18),
  ('CHANT',    'Chant',                      19),
  ('DESSIN',   'Dessin',                     20),
  ('POESIE',   'Poésie',                     21),
  ('MUSIQUE',  'Musique',                    22),
  ('TRAV_MAN', 'Travaux manuels',            23),
  ('GRAPH',    'Graphisme',                  24),
  ('INFO',     'Informatique (TICE)',        25)
) as v(code, libelle, ordre)
where not exists (select 1 from matieres m where lower(m.libelle) = lower(v.libelle) or m.code = v.code);

-- Autorise tout utilisateur connecté (directeur, agent de saisie, inspecteur)
-- à ajouter une matière qui n'est pas dans la liste.
drop policy if exists matieres_ajout on matieres;
create policy matieres_ajout on matieres for insert to authenticated
  with check (mon_role() is not null);

select libelle from matieres order by ordre, libelle;
