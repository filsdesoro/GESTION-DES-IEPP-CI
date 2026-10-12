// =====================================================================
//  Gestion IEPP — serveur API (Render)
//  Rôle : opérations qui exigent la clé « service_role » de Supabase,
//  qui ne doit jamais se trouver dans le navigateur :
//    - créer un compte utilisateur (auth + profil)
//    - réinitialiser un mot de passe
//    - supprimer un compte
//    - lister les emails des comptes
//  Toutes les autres données passent directement par Supabase,
//  protégées par les règles RLS de la base.
// =====================================================================
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DB_SCHEMA = 'public', CORS_ORIGINS = '*', PORT = 3000 } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Variables manquantes : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: DB_SCHEMA },
});

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors({
  origin: CORS_ORIGINS === '*' ? true : CORS_ORIGINS.split(',').map((s) => s.trim()),
}));

const ROLES = ['superviseur', 'iepp', 'conseiller', 'directeur', 'saisie'];

// ---------- Utilitaires ----------
const erreur = (res, code, message) => res.status(code).json({ erreur: message });

/** Vérifie le jeton de l'appelant et charge son profil. */
async function authentifier(req, res, next) {
  try {
    const jeton = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!jeton) return erreur(res, 401, 'Non connecté.');
    const { data, error } = await admin.auth.getUser(jeton);
    if (error || !data?.user) return erreur(res, 401, 'Session expirée, reconnectez-vous.');
    const { data: profil } = await admin.from('profils').select('*').eq('id', data.user.id).maybeSingle();
    if (!profil || !profil.actif) return erreur(res, 403, 'Compte sans profil ou désactivé.');
    if (!['superviseur', 'iepp'].includes(profil.role)) return erreur(res, 403, 'Seuls le superviseur et les inspecteurs gèrent les comptes.');
    req.appelant = profil;
    next();
  } catch (e) {
    erreur(res, 500, e.message);
  }
}

/** L'appelant peut-il gérer ce profil (existant ou à créer) ? */
function peutGerer(appelant, cible) {
  if (appelant.role === 'superviseur') return true;
  return appelant.role === 'iepp'
    && cible.iepp_id === appelant.iepp_id
    && ['conseiller', 'directeur', 'saisie'].includes(cible.role);
}

/** Vérifie la cohérence du périmètre (secteur / école dans la bonne IEPP). */
async function validerPerimetre(p) {
  if (!ROLES.includes(p.role)) return 'Rôle invalide.';
  if (p.role === 'superviseur') return null;
  if (!p.iepp_id) return 'Circonscription obligatoire.';
  if (p.role === 'conseiller') {
    if (!p.secteur_id) return 'Secteur obligatoire pour un conseiller.';
    const { data } = await admin.from('secteurs').select('iepp_id').eq('id', p.secteur_id).maybeSingle();
    if (data?.iepp_id !== p.iepp_id) return "Ce secteur n'appartient pas à la circonscription.";
  }
  if (p.role === 'directeur' || p.role === 'saisie') {
    if (!p.ecole_id) return 'École obligatoire.';
    const { data } = await admin.from('ecoles').select('iepp_id').eq('id', p.ecole_id).maybeSingle();
    if (data?.iepp_id !== p.iepp_id) return "Cette école n'appartient pas à la circonscription.";
  }
  return null;
}

async function journaliser(user_id, action, cible_id, details) {
  await admin.from('journal').insert({ user_id, action, table_cible: 'profils', cible_id, details });
}

// ---------- Routes ----------
app.get('/', (_req, res) => res.json({ service: 'Gestion IEPP API', etat: 'ok' }));
app.get('/health', (_req, res) => res.json({ etat: 'ok', heure: new Date().toISOString() }));

// Liste des comptes visibles avec leur email
app.get('/api/comptes', authentifier, async (req, res) => {
  let q = admin.from('profils').select('id, role, iepp_id');
  if (req.appelant.role === 'iepp') q = q.eq('iepp_id', req.appelant.iepp_id);
  const { data: profils, error } = await q;
  if (error) return erreur(res, 500, error.message);
  const ids = new Set(profils.map((p) => p.id));
  const comptes = [];
  for (let page = 1; page < 50; page++) {
    const { data, error: e } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (e) return erreur(res, 500, e.message);
    data.users.filter((u) => ids.has(u.id)).forEach((u) => comptes.push({ id: u.id, email: u.email, derniere_connexion: u.last_sign_in_at }));
    if (data.users.length < 1000) break;
  }
  res.json({ comptes });
});

// Création d'un compte
app.post('/api/comptes', authentifier, async (req, res) => {
  const { email, mot_de_passe, nom_complet, role, iepp_id = null, secteur_id = null, ecole_id = null } = req.body || {};
  if (!email || !mot_de_passe || !nom_complet || !role) return erreur(res, 400, 'Email, mot de passe, nom et rôle sont obligatoires.');
  if (String(mot_de_passe).length < 8) return erreur(res, 400, 'Mot de passe trop court (8 caractères minimum).');
  const profil = {
    nom_complet: String(nom_complet).trim(), role,
    iepp_id: role === 'superviseur' ? null : iepp_id,
    secteur_id: role === 'conseiller' ? secteur_id : null,
    ecole_id: role === 'directeur' || role === 'saisie' ? ecole_id : null,
  };
  if (!peutGerer(req.appelant, profil)) return erreur(res, 403, "Vous ne pouvez pas créer ce type de compte.");
  const invalide = await validerPerimetre(profil);
  if (invalide) return erreur(res, 400, invalide);

  const { data, error } = await admin.auth.admin.createUser({
    email: String(email).trim().toLowerCase(), password: mot_de_passe, email_confirm: true,
    user_metadata: { nom_complet: profil.nom_complet, application: 'gestion-iepp' },
  });
  if (error) {
    const deja = /already|registered|exists/i.test(error.message);
    return erreur(res, 400, deja ? 'Cet email est déjà utilisé.' : error.message);
  }
  const { error: e2 } = await admin.from('profils').insert({ id: data.user.id, ...profil });
  if (e2) {
    await admin.auth.admin.deleteUser(data.user.id);
    return erreur(res, 400, e2.message);
  }
  await journaliser(req.appelant.id, 'creation_compte', data.user.id, { email, role });
  res.status(201).json({ id: data.user.id });
});

// Réinitialisation du mot de passe
app.post('/api/comptes/:id/mot-de-passe', authentifier, async (req, res) => {
  const { mot_de_passe } = req.body || {};
  if (!mot_de_passe || String(mot_de_passe).length < 8) return erreur(res, 400, 'Mot de passe trop court (8 caractères minimum).');
  const { data: cible } = await admin.from('profils').select('*').eq('id', req.params.id).maybeSingle();
  if (!cible) return erreur(res, 404, 'Compte introuvable.');
  if (!peutGerer(req.appelant, cible)) return erreur(res, 403, 'Action non autorisée.');
  const { error } = await admin.auth.admin.updateUserById(req.params.id, { password: mot_de_passe });
  if (error) return erreur(res, 400, error.message);
  await journaliser(req.appelant.id, 'reinitialisation_mdp', req.params.id, null);
  res.json({ ok: true });
});

// Suppression d'un compte
app.delete('/api/comptes/:id', authentifier, async (req, res) => {
  if (req.params.id === req.appelant.id) return erreur(res, 400, 'Vous ne pouvez pas supprimer votre propre compte.');
  const { data: cible } = await admin.from('profils').select('*').eq('id', req.params.id).maybeSingle();
  if (!cible) return erreur(res, 404, 'Compte introuvable.');
  if (!peutGerer(req.appelant, cible)) return erreur(res, 403, 'Action non autorisée.');
  const { error } = await admin.auth.admin.deleteUser(req.params.id); // le profil est supprimé en cascade
  if (error) return erreur(res, 400, error.message);
  await journaliser(req.appelant.id, 'suppression_compte', req.params.id, { role: cible.role });
  res.json({ ok: true });
});

app.use((_req, res) => erreur(res, 404, 'Route inconnue.'));

app.listen(PORT, () => console.log(`Gestion IEPP API — port ${PORT}, schéma ${DB_SCHEMA}`));
