-- =====================================================================
--  GESTION IEPP — installation dans un projet Supabase dédié (schéma public)
--  À coller entièrement dans Supabase > SQL Editor > New query, puis Run
-- =====================================================================

-- =====================================================================
--  GESTION IEPP — Schéma de base de données (Supabase / PostgreSQL)
--  Circonscriptions de l'enseignement préscolaire et primaire
--  Côte d'Ivoire
--
--  À exécuter dans : Supabase > SQL Editor (projet neuf)
--  Ordre : 1. Extensions  2. Types  3. Référentiel  4. Structures
--          5. Personnel   6. Élèves 7. Évaluations  8. CEPE
--          9. Comptes & sécurité (RLS)  10. Vues (statistiques, saisie)
-- =====================================================================


-- =====================================================================
-- 2. TYPES ÉNUMÉRÉS
-- =====================================================================
create type statut_ecole      as enum ('public', 'prive_laic', 'prive_confessionnel', 'communautaire');
create type cycle_ecole       as enum ('prescolaire', 'primaire', 'mixte');
create type milieu_ecole      as enum ('urbain', 'rural');
create type sexe_type         as enum ('M', 'F');
create type statut_eleve      as enum ('nouveau', 'redoublant', 'transfere_entrant');
create type decision_fin      as enum ('admis', 'redouble', 'exclu', 'abandon', 'transfere');
create type role_utilisateur  as enum ('superviseur', 'iepp', 'conseiller', 'directeur', 'saisie');
create type position_agent    as enum ('en_activite', 'conge', 'detachement', 'disponibilite', 'stage', 'retraite', 'decede');

-- =====================================================================
-- 3. RÉFÉRENTIEL NATIONAL
-- =====================================================================

-- Années scolaires (une seule active à la fois)
create table annees_scolaires (
  id          uuid primary key default gen_random_uuid(),
  libelle     text not null unique,               -- ex. '2026-2027'
  date_debut  date not null,
  date_fin    date not null,
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  check (date_fin > date_debut)
);
create unique index annee_active_unique on annees_scolaires (active) where active;

-- Niveaux d'enseignement (préscolaire + primaire)
create table niveaux (
  code     text primary key,                      -- PS, MS, GS, CP1 … CM2
  libelle  text not null,
  cycle    text not null check (cycle in ('prescolaire', 'primaire')),
  ordre    smallint not null unique
);
insert into niveaux (code, libelle, cycle, ordre) values
  ('PS',  'Petite Section',        'prescolaire', 1),
  ('MS',  'Moyenne Section',       'prescolaire', 2),
  ('GS',  'Grande Section',        'prescolaire', 3),
  ('CP1', 'Cours Préparatoire 1',  'primaire',    4),
  ('CP2', 'Cours Préparatoire 2',  'primaire',    5),
  ('CE1', 'Cours Élémentaire 1',   'primaire',    6),
  ('CE2', 'Cours Élémentaire 2',   'primaire',    7),
  ('CM1', 'Cours Moyen 1',         'primaire',    8),
  ('CM2', 'Cours Moyen 2',         'primaire',    9);

-- Emplois / grades du personnel
create table emplois (
  code     text primary key,
  libelle  text not null,
  ordre    smallint not null default 0
);
insert into emplois (code, libelle, ordre) values
  ('IEPP', 'Inspecteur de l''Enseignement Préscolaire et Primaire', 1),
  ('CP',   'Conseiller Pédagogique',               2),
  ('IO',   'Instituteur Ordinaire',                3),
  ('IA',   'Instituteur Adjoint',                  4),
  ('EDUC', 'Éducateur (préscolaire)',              5),
  ('BENE', 'Enseignant bénévole / communautaire',  6),
  ('ADM',  'Personnel administratif',              7),
  ('AUTRE','Autre',                                9);

-- Fonctions (rôle occupé, distinct du grade)
create table fonctions (
  code     text primary key,
  libelle  text not null
);
insert into fonctions (code, libelle) values
  ('CHEF_CIRC', 'Chef de circonscription (IEPP)'),
  ('CP_SECT',   'Conseiller pédagogique de secteur'),
  ('DIR_DECH',  'Directeur d''école déchargé'),
  ('DIR_CLASSE','Directeur d''école chargé de classe'),
  ('MAITRE',    'Maître de classe'),
  ('SECR',      'Secrétaire'),
  ('AUTRE',     'Autre');

-- Matières / disciplines (paramétrables par niveau)
create table matieres (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  libelle   text not null,
  ordre     smallint not null default 0,
  actif     boolean not null default true
);
insert into matieres (code, libelle, ordre) values
  ('FR_EXPL', 'Exploitation de texte',          1),
  ('FR_ORTH', 'Orthographe / Dictée',           2),
  ('FR_EXPR', 'Expression écrite',              3),
  ('MATH',    'Mathématiques',                  4),
  ('EDHC',    'EDHC',                           5),
  ('SCI',     'Sciences et Technologie',        6),
  ('HG',      'Histoire-Géographie',            7),
  ('ANG',     'Anglais',                        8),
  ('EPS',     'Éducation Physique et Sportive', 9),
  ('AEC',     'Activités d''Expression et de Création', 10);

-- Barème d'une matière pour un niveau (note sur X, coefficient)
create table matieres_niveaux (
  matiere_id   uuid not null references matieres(id) on delete cascade,
  niveau_code  text not null references niveaux(code),
  note_sur     numeric(5,2) not null default 10,
  coefficient  numeric(4,2) not null default 1,
  primary key (matiere_id, niveau_code)
);

-- =====================================================================
-- 4. STRUCTURES ADMINISTRATIVES
-- =====================================================================

-- Directions Régionales (DRENA)
create table drena (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  nom         text not null unique,
  chef_lieu   text,
  created_at  timestamptz not null default now()
);

-- Circonscriptions (IEPP)
create table iepp (
  id            uuid primary key default gen_random_uuid(),
  drena_id      uuid not null references drena(id),
  code          text unique,
  nom           text not null,                    -- ex. 'IEPP Agboville 1'
  localite      text,
  adresse       text,
  telephone     text,
  email         text,
  logo_url      text,
  boite_postale text,
  created_at    timestamptz not null default now(),
  unique (drena_id, nom)
);

-- Secteurs pédagogiques (suivis par un conseiller pédagogique)
create table secteurs (
  id          uuid primary key default gen_random_uuid(),
  iepp_id     uuid not null references iepp(id) on delete cascade,
  nom         text not null,
  conseiller_id uuid,                              -- FK ajoutée après la table personnel
  created_at  timestamptz not null default now(),
  unique (iepp_id, nom)
);

-- Écoles
create table ecoles (
  id             uuid primary key default gen_random_uuid(),
  iepp_id        uuid not null references iepp(id) on delete cascade,
  secteur_id     uuid references secteurs(id) on delete set null,
  code_ecole     text unique,                      -- code MENA / carte scolaire
  nom            text not null,
  statut         statut_ecole not null default 'public',
  cycle          cycle_ecole  not null default 'primaire',
  milieu         milieu_ecole,
  localite       text,
  sous_prefecture text,
  latitude       numeric(9,6),
  longitude      numeric(9,6),
  annee_creation smallint,
  telephone      text,
  -- Infrastructures (carte scolaire)
  nb_salles      smallint default 0,
  nb_salles_bon_etat smallint default 0,
  nb_tables_bancs smallint default 0,
  a_cantine      boolean default false,
  a_latrines     boolean default false,
  a_point_eau    boolean default false,
  a_electricite  boolean default false,
  a_cloture      boolean default false,
  actif          boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on ecoles (iepp_id);
create index on ecoles (secteur_id);

-- Classes (par école et par année)
create table classes (
  id           uuid primary key default gen_random_uuid(),
  ecole_id     uuid not null references ecoles(id) on delete cascade,
  annee_id     uuid not null references annees_scolaires(id),
  niveau_code  text not null references niveaux(code),
  nom          text not null,                     -- ex. 'CM2 A'
  maitre_id    uuid,                              -- FK ajoutée après personnel
  multigrade   boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (ecole_id, annee_id, nom)
);
create index on classes (annee_id, niveau_code);

-- =====================================================================
-- 5. PERSONNEL
-- =====================================================================
create table personnel (
  id              uuid primary key default gen_random_uuid(),
  matricule       text unique,
  nom             text not null,
  prenoms         text not null,
  sexe            sexe_type,
  date_naissance  date,
  lieu_naissance  text,
  telephone       text,
  email           text,
  emploi_code     text references emplois(code),
  diplome_prof    text,                           -- CAP, CEAP…
  diplome_acad    text,                           -- BEPC, BAC, Licence…
  date_entree_fp  date,                           -- entrée fonction publique
  position        position_agent not null default 'en_activite',
  photo_url       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on personnel (nom, prenoms);

-- Affectations (historisées par année)
create table affectations (
  id             uuid primary key default gen_random_uuid(),
  personnel_id   uuid not null references personnel(id) on delete cascade,
  annee_id       uuid not null references annees_scolaires(id),
  iepp_id        uuid not null references iepp(id),
  ecole_id       uuid references ecoles(id) on delete set null,   -- null = bureau IEPP
  fonction_code  text references fonctions(code),
  date_prise_service date,
  observations   text,
  created_at     timestamptz not null default now(),
  unique (personnel_id, annee_id)
);
create index on affectations (iepp_id, annee_id);
create index on affectations (ecole_id);

alter table secteurs add constraint secteurs_conseiller_fk
  foreign key (conseiller_id) references personnel(id) on delete set null;
alter table classes  add constraint classes_maitre_fk
  foreign key (maitre_id) references personnel(id) on delete set null;

-- =====================================================================
-- 6. ÉLÈVES
-- =====================================================================
create table eleves (
  id              uuid primary key default gen_random_uuid(),
  matricule       text unique,                    -- matricule national si connu
  nom             text not null,
  prenoms         text not null,
  sexe            sexe_type not null,
  date_naissance  date,
  lieu_naissance  text,
  extrait_naissance boolean default false,        -- possède un extrait d'acte
  num_extrait     text,
  nationalite     text default 'Ivoirienne',
  nom_parent      text,
  telephone_parent text,
  photo_url       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on eleves (nom, prenoms);

-- Inscription d'un élève dans une classe pour une année
create table inscriptions (
  id            uuid primary key default gen_random_uuid(),
  eleve_id      uuid not null references eleves(id) on delete cascade,
  classe_id     uuid not null references classes(id) on delete cascade,
  annee_id      uuid not null references annees_scolaires(id),
  statut        statut_eleve not null default 'nouveau',
  date_inscription date default current_date,
  decision      decision_fin,                     -- renseignée en fin d'année
  moyenne_annuelle numeric(5,2),
  rang_annuel   smallint,
  created_at    timestamptz not null default now(),
  unique (eleve_id, annee_id)
);
create index on inscriptions (classe_id);

-- Fiches EPS (aptitude / dispense)
create table fiches_eps (
  id            uuid primary key default gen_random_uuid(),
  inscription_id uuid not null references inscriptions(id) on delete cascade,
  apte          boolean not null default true,
  motif_inaptitude text,
  taille_cm     numeric(5,1),
  poids_kg      numeric(5,1),
  observations  text,
  created_at    timestamptz not null default now(),
  unique (inscription_id)
);

-- =====================================================================
-- 7. ÉVALUATIONS (compositions, notes)
-- =====================================================================

-- Compositions organisées par la circonscription (ou par école)
create table compositions (
  id          uuid primary key default gen_random_uuid(),
  annee_id    uuid not null references annees_scolaires(id),
  iepp_id     uuid not null references iepp(id) on delete cascade,
  libelle     text not null,                      -- ex. '1re composition', 'Composition de passage'
  ordre       smallint not null default 1,
  date_debut  date,
  date_fin    date,
  saisie_ouverte boolean not null default true,
  niveaux     text[] not null default array['CP1','CP2','CE1','CE2','CM1','CM2'],
  created_at  timestamptz not null default now(),
  unique (iepp_id, annee_id, libelle)
);

-- Notes par élève / matière / composition
create table notes (
  id              uuid primary key default gen_random_uuid(),
  composition_id  uuid not null references compositions(id) on delete cascade,
  inscription_id  uuid not null references inscriptions(id) on delete cascade,
  matiere_id      uuid not null references matieres(id),
  note            numeric(5,2),
  absent          boolean not null default false,
  saisie_par      uuid,                            -- auth.users.id
  updated_at      timestamptz not null default now(),
  unique (composition_id, inscription_id, matiere_id),
  check (note is null or note >= 0)
);
create index on notes (inscription_id);
create index on notes (composition_id);

-- Résultats calculés par composition (moyenne, rang)
create table resultats_composition (
  composition_id  uuid not null references compositions(id) on delete cascade,
  inscription_id  uuid not null references inscriptions(id) on delete cascade,
  total_points    numeric(7,2),
  moyenne         numeric(5,2),
  rang            smallint,
  appreciation    text,
  calcule_le      timestamptz not null default now(),
  primary key (composition_id, inscription_id)
);

-- =====================================================================
-- 8. CEPE
-- =====================================================================
create table cepe_centres (
  id          uuid primary key default gen_random_uuid(),
  annee_id    uuid not null references annees_scolaires(id),
  iepp_id     uuid not null references iepp(id) on delete cascade,
  ecole_id    uuid references ecoles(id),          -- école servant de centre
  nom         text not null,
  chef_centre_id uuid references personnel(id),
  capacite    integer,
  unique (annee_id, iepp_id, nom)
);

create table cepe_candidats (
  id              uuid primary key default gen_random_uuid(),
  inscription_id  uuid not null references inscriptions(id) on delete cascade,
  centre_id       uuid references cepe_centres(id) on delete set null,
  numero_table    text,
  epreuve_eps     boolean not null default true,   -- apte EPS
  langue_vivante  text,
  convocation_imprimee boolean not null default false,
  -- Résultats
  total_points    numeric(6,2),                    -- TGP
  admis           boolean,
  mention         text,
  created_at      timestamptz not null default now(),
  unique (inscription_id),
  unique (centre_id, numero_table)
);

-- =====================================================================
-- 9. COMPTES UTILISATEURS & SÉCURITÉ
-- =====================================================================
create table profils (
  id          uuid primary key references auth.users(id) on delete cascade,
  nom_complet text not null,
  role        role_utilisateur not null,
  -- Périmètre d'action selon le rôle
  iepp_id     uuid references iepp(id),           -- iepp, conseiller, directeur, saisie
  secteur_id  uuid references secteurs(id),       -- conseiller
  ecole_id    uuid references ecoles(id),         -- directeur, saisie
  personnel_id uuid references personnel(id),
  actif       boolean not null default true,
  created_at  timestamptz not null default now(),
  check (
    (role = 'superviseur')
    or (role = 'iepp'       and iepp_id is not null)
    or (role = 'conseiller' and iepp_id is not null and secteur_id is not null)
    or (role in ('directeur','saisie') and iepp_id is not null and ecole_id is not null)
  )
);

-- Journal d'activité
create table journal (
  id          bigserial primary key,
  user_id     uuid references auth.users(id),
  action      text not null,
  table_cible text,
  cible_id    uuid,
  details     jsonb,
  created_at  timestamptz not null default now()
);

-- ---------- Fonctions d'aide pour les règles d'accès ----------
create or replace function mon_role() returns role_utilisateur
language sql stable security definer set search_path = public as $$
  select role from profils where id = auth.uid() and actif
$$;

create or replace function mon_iepp() returns uuid
language sql stable security definer set search_path = public as $$
  select iepp_id from profils where id = auth.uid() and actif
$$;

create or replace function est_superviseur() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'superviseur' from profils where id = auth.uid() and actif), false)
$$;

-- Peut voir une école donnée ?
create or replace function peut_voir_ecole(p_ecole uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from profils p
    join ecoles e on e.id = p_ecole
    where p.id = auth.uid() and p.actif and (
         p.role = 'superviseur'
      or (p.role = 'iepp'       and e.iepp_id = p.iepp_id)
      or (p.role = 'conseiller' and e.secteur_id = p.secteur_id)
      or (p.role in ('directeur','saisie') and e.id = p.ecole_id)
    )
  )
$$;

-- Peut voir une IEPP donnée ?
create or replace function peut_voir_iepp(p_iepp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select est_superviseur() or mon_iepp() = p_iepp
$$;

-- Peut administrer (écrire) au niveau circonscription ?
create or replace function peut_gerer_iepp(p_iepp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select est_superviseur() or (mon_role() = 'iepp' and mon_iepp() = p_iepp)
$$;

-- ---------- Activation RLS ----------
alter table drena                 enable row level security;
alter table iepp                  enable row level security;
alter table secteurs              enable row level security;
alter table ecoles                enable row level security;
alter table classes               enable row level security;
alter table personnel             enable row level security;
alter table affectations          enable row level security;
alter table eleves                enable row level security;
alter table inscriptions          enable row level security;
alter table fiches_eps            enable row level security;
alter table compositions          enable row level security;
alter table notes                 enable row level security;
alter table resultats_composition enable row level security;
alter table cepe_centres          enable row level security;
alter table cepe_candidats        enable row level security;
alter table profils               enable row level security;
alter table journal               enable row level security;
alter table annees_scolaires      enable row level security;
alter table niveaux               enable row level security;
alter table emplois               enable row level security;
alter table fonctions             enable row level security;
alter table matieres              enable row level security;
alter table matieres_niveaux      enable row level security;

-- Référentiels : lecture pour tout utilisateur connecté, écriture superviseur
do $$
declare t text;
begin
  foreach t in array array['annees_scolaires','niveaux','emplois','fonctions','matieres','matieres_niveaux','drena']
  loop
    execute format('create policy "%1$s_lecture" on %1$I for select to authenticated using (true)', t);
    execute format('create policy "%1$s_ecriture" on %1$I for all to authenticated using (est_superviseur()) with check (est_superviseur())', t);
  end loop;
end $$;

-- IEPP
create policy iepp_lecture  on iepp for select to authenticated using (peut_voir_iepp(id));
create policy iepp_ecriture on iepp for all    to authenticated using (peut_gerer_iepp(id)) with check (peut_gerer_iepp(id));

-- Secteurs
create policy secteurs_lecture  on secteurs for select to authenticated using (peut_voir_iepp(iepp_id));
create policy secteurs_ecriture on secteurs for all    to authenticated using (peut_gerer_iepp(iepp_id)) with check (peut_gerer_iepp(iepp_id));

-- Écoles : lecture selon périmètre ; le directeur peut mettre à jour sa fiche
create policy ecoles_lecture on ecoles for select to authenticated using (peut_voir_ecole(id));
create policy ecoles_gestion on ecoles for all    to authenticated using (peut_gerer_iepp(iepp_id)) with check (peut_gerer_iepp(iepp_id));
create policy ecoles_directeur_maj on ecoles for update to authenticated
  using (mon_role() = 'directeur' and peut_voir_ecole(id))
  with check (mon_role() = 'directeur' and peut_voir_ecole(id));

-- Classes, inscriptions : école dans le périmètre
create policy classes_lecture  on classes for select to authenticated using (peut_voir_ecole(ecole_id));
create policy classes_ecriture on classes for all to authenticated
  using (peut_voir_ecole(ecole_id) and mon_role() <> 'conseiller')
  with check (peut_voir_ecole(ecole_id) and mon_role() <> 'conseiller');

create policy inscriptions_acces on inscriptions for all to authenticated
  using (peut_voir_ecole((select ecole_id from classes c where c.id = classe_id)))
  with check (peut_voir_ecole((select ecole_id from classes c where c.id = classe_id)));

-- Élèves : visibles si au moins une inscription dans le périmètre
create policy eleves_lecture on eleves for select to authenticated using (
  est_superviseur() or exists (
    select 1 from inscriptions i join classes c on c.id = i.classe_id
    where i.eleve_id = eleves.id and peut_voir_ecole(c.ecole_id)));
create policy eleves_insert on eleves for insert to authenticated with check (mon_role() is not null);
create policy eleves_update on eleves for update to authenticated using (
  est_superviseur() or exists (
    select 1 from inscriptions i join classes c on c.id = i.classe_id
    where i.eleve_id = eleves.id and peut_voir_ecole(c.ecole_id)));

-- Fiches EPS
create policy eps_acces on fiches_eps for all to authenticated
  using (exists (select 1 from inscriptions i join classes c on c.id = i.classe_id
                 where i.id = inscription_id and peut_voir_ecole(c.ecole_id)))
  with check (exists (select 1 from inscriptions i join classes c on c.id = i.classe_id
                 where i.id = inscription_id and peut_voir_ecole(c.ecole_id)));

-- Personnel & affectations
create policy personnel_lecture on personnel for select to authenticated using (
  est_superviseur() or exists (
    select 1 from affectations a where a.personnel_id = personnel.id and peut_voir_iepp(a.iepp_id)));
create policy personnel_ecriture on personnel for all to authenticated
  using (est_superviseur() or mon_role() = 'iepp')
  with check (est_superviseur() or mon_role() = 'iepp');

create policy affectations_lecture  on affectations for select to authenticated using (peut_voir_iepp(iepp_id));
create policy affectations_ecriture on affectations for all to authenticated
  using (peut_gerer_iepp(iepp_id)) with check (peut_gerer_iepp(iepp_id));

-- Compositions
create policy compositions_lecture  on compositions for select to authenticated using (peut_voir_iepp(iepp_id));
create policy compositions_ecriture on compositions for all to authenticated
  using (peut_gerer_iepp(iepp_id)) with check (peut_gerer_iepp(iepp_id));

-- Notes : saisie possible seulement si la composition est ouverte
create policy notes_lecture on notes for select to authenticated using (
  exists (select 1 from inscriptions i join classes c on c.id = i.classe_id
          where i.id = inscription_id and peut_voir_ecole(c.ecole_id)));
create policy notes_saisie on notes for all to authenticated
  using (
    exists (select 1 from inscriptions i join classes c on c.id = i.classe_id
            where i.id = inscription_id and peut_voir_ecole(c.ecole_id))
    and (est_superviseur() or exists (select 1 from compositions k where k.id = composition_id and k.saisie_ouverte)))
  with check (
    exists (select 1 from inscriptions i join classes c on c.id = i.classe_id
            where i.id = inscription_id and peut_voir_ecole(c.ecole_id))
    and (est_superviseur() or exists (select 1 from compositions k where k.id = composition_id and k.saisie_ouverte)));

create policy resultats_lecture on resultats_composition for select to authenticated using (
  exists (select 1 from inscriptions i join classes c on c.id = i.classe_id
          where i.id = inscription_id and peut_voir_ecole(c.ecole_id)));

-- CEPE
create policy cepe_centres_lecture  on cepe_centres for select to authenticated using (peut_voir_iepp(iepp_id));
create policy cepe_centres_ecriture on cepe_centres for all to authenticated
  using (peut_gerer_iepp(iepp_id)) with check (peut_gerer_iepp(iepp_id));
create policy cepe_candidats_acces on cepe_candidats for all to authenticated
  using (exists (select 1 from inscriptions i join classes c on c.id = i.classe_id
                 where i.id = inscription_id and peut_voir_ecole(c.ecole_id)))
  with check (exists (select 1 from inscriptions i join classes c on c.id = i.classe_id
                 where i.id = inscription_id and peut_voir_ecole(c.ecole_id)));

-- Profils : chacun voit le sien ; l'IEPP voit/gère ceux de sa circonscription
create policy profils_soi       on profils for select to authenticated using (id = auth.uid());
create policy profils_gestion   on profils for all to authenticated
  using (est_superviseur() or (mon_role() = 'iepp' and iepp_id = mon_iepp() and role <> 'superviseur'))
  with check (est_superviseur() or (mon_role() = 'iepp' and iepp_id = mon_iepp() and role in ('conseiller','directeur','saisie')));

-- Journal : insertion par tous, lecture superviseur / IEPP
create policy journal_insert  on journal for insert to authenticated with check (user_id = auth.uid());
create policy journal_lecture on journal for select to authenticated using (est_superviseur() or mon_role() = 'iepp');

-- =====================================================================
-- 10. FONCTIONS MÉTIER & VUES
-- =====================================================================

-- Horodatage automatique
create or replace function maj_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger t_ecoles_maj    before update on ecoles    for each row execute function maj_updated_at();
create trigger t_personnel_maj before update on personnel for each row execute function maj_updated_at();
create trigger t_eleves_maj    before update on eleves    for each row execute function maj_updated_at();
create trigger t_notes_maj     before update on notes     for each row execute function maj_updated_at();

-- Calcul des moyennes et rangs d'une composition pour une classe
-- Moyenne ramenée sur 10 : somme(note/note_sur*10*coef) / somme(coef)
create or replace function calculer_resultats(p_composition uuid, p_classe uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Contrôle d'accès : l'utilisateur doit avoir la classe dans son périmètre
  if not peut_voir_ecole((select ecole_id from classes where id = p_classe)) then
    raise exception 'Accès refusé à cette classe';
  end if;

  delete from resultats_composition r
   using inscriptions i
   where r.composition_id = p_composition and r.inscription_id = i.id and i.classe_id = p_classe;

  insert into resultats_composition (composition_id, inscription_id, total_points, moyenne, rang)
  select p_composition, x.inscription_id, x.total, x.moyenne,
         rank() over (order by x.moyenne desc nulls last)
  from (
    select i.id as inscription_id,
           sum(n.note * mn.coefficient)                          as total,
           round(sum(n.note / mn.note_sur * 10 * mn.coefficient)
                 / nullif(sum(mn.coefficient), 0), 2)            as moyenne
    from inscriptions i
    join classes c on c.id = i.classe_id
    left join notes n on n.inscription_id = i.id and n.composition_id = p_composition
                     and not n.absent and n.note is not null
    left join matieres_niveaux mn on mn.matiere_id = n.matiere_id and mn.niveau_code = c.niveau_code
    where i.classe_id = p_classe
    group by i.id
  ) x;
end $$;

-- Effectifs par école / niveau / sexe (année active)
create or replace view v_effectifs with (security_invoker = true) as
select e.iepp_id, e.secteur_id, e.id as ecole_id, e.nom as ecole, e.statut,
       c.niveau_code, n.ordre,
       count(*) filter (where el.sexe = 'M') as garcons,
       count(*) filter (where el.sexe = 'F') as filles,
       count(*)                              as total,
       count(*) filter (where i.statut = 'redoublant') as redoublants
from inscriptions i
join classes c   on c.id = i.classe_id
join annees_scolaires a on a.id = c.annee_id and a.active
join ecoles e    on e.id = c.ecole_id
join eleves el   on el.id = i.eleve_id
join niveaux n   on n.code = c.niveau_code
group by e.iepp_id, e.secteur_id, e.id, e.nom, e.statut, c.niveau_code, n.ordre;

-- Statistiques globales par circonscription
create or replace view v_stats_iepp with (security_invoker = true) as
select i.id as iepp_id, i.nom,
  (select count(*) from ecoles e where e.iepp_id = i.id and e.actif)                             as nb_ecoles,
  (select count(*) from ecoles e where e.iepp_id = i.id and e.actif and e.statut = 'public')     as nb_ecoles_publiques,
  (select count(*) from secteurs s where s.iepp_id = i.id)                                       as nb_secteurs,
  (select coalesce(sum(total),0)   from v_effectifs v where v.iepp_id = i.id)                    as nb_eleves,
  (select coalesce(sum(filles),0)  from v_effectifs v where v.iepp_id = i.id)                    as nb_filles,
  (select count(*) from affectations a join annees_scolaires an on an.id = a.annee_id and an.active
     where a.iepp_id = i.id)                                                                     as nb_personnel,
  (select count(*) from classes c join ecoles e on e.id = c.ecole_id
     join annees_scolaires an on an.id = c.annee_id and an.active where e.iepp_id = i.id)        as nb_classes
from iepp i;

-- Suivi de la saisie des notes : taux de remplissage par classe et composition
create or replace view v_suivi_saisie with (security_invoker = true) as
select k.id as composition_id, k.libelle as composition,
       e.iepp_id, e.secteur_id, e.id as ecole_id, e.nom as ecole,
       c.id as classe_id, c.nom as classe, c.niveau_code,
       count(distinct i.id)                                          as nb_eleves,
       (select count(*) from matieres_niveaux mn where mn.niveau_code = c.niveau_code) as nb_matieres,
       count(n.id)                                                   as nb_notes_saisies,
       round(100.0 * count(n.id) / nullif(count(distinct i.id) *
             (select count(*) from matieres_niveaux mn where mn.niveau_code = c.niveau_code), 0), 1) as taux_saisie
from compositions k
join ecoles e  on e.iepp_id = k.iepp_id
join classes c on c.ecole_id = e.id and c.annee_id = k.annee_id and c.niveau_code = any(k.niveaux)
join inscriptions i on i.classe_id = c.id
left join notes n on n.inscription_id = i.id and n.composition_id = k.id
                 and (n.note is not null or n.absent)
group by k.id, k.libelle, e.iepp_id, e.secteur_id, e.id, e.nom, c.id, c.nom, c.niveau_code;

-- Bilan annuel par école (taux de passage, redoublement, abandon)
create or replace view v_bilan_annuel with (security_invoker = true) as
select a.libelle as annee, e.iepp_id, e.id as ecole_id, e.nom as ecole, c.niveau_code,
       count(*)                                         as inscrits,
       count(*) filter (where i.decision = 'admis')     as admis,
       count(*) filter (where i.decision = 'redouble')  as redoublants,
       count(*) filter (where i.decision = 'abandon')   as abandons,
       round(100.0 * count(*) filter (where i.decision = 'admis') / nullif(count(*),0), 1) as taux_passage
from inscriptions i
join classes c on c.id = i.classe_id
join annees_scolaires a on a.id = c.annee_id
join ecoles e on e.id = c.ecole_id
group by a.libelle, e.iepp_id, e.id, e.nom, c.niveau_code;

-- Résultats CEPE par centre
create or replace view v_resultats_cepe with (security_invoker = true) as
select ce.annee_id, ce.iepp_id, ce.id as centre_id, ce.nom as centre,
       count(*)                                          as candidats,
       count(*) filter (where cd.admis)                  as admis,
       round(100.0 * count(*) filter (where cd.admis) / nullif(count(*),0), 1) as taux_reussite
from cepe_candidats cd
join cepe_centres ce on ce.id = cd.centre_id
group by ce.annee_id, ce.iepp_id, ce.id, ce.nom;

-- =====================================================================
-- FIN — Prochaine étape : créer le compte superviseur
--   1. Créer l'utilisateur dans Authentication > Users
--   2. insert into profils (id, nom_complet, role)
--      values ('<uuid-de-l-utilisateur>', 'Superviseur', 'superviseur');
-- =====================================================================

-- =====================================================================
-- Droits d'accès au schéma iepp pour l'API Supabase
-- =====================================================================
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables    in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public grant all on tables    to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
