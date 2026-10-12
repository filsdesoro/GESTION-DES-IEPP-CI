// Crée le tout premier compte (superviseur), une seule fois après l'installation.
// Usage :  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DB_SCHEMA=public \
//          node creer-superviseur.js email@exemple.ci "MotDePasse123" "Nom du superviseur"
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DB_SCHEMA = 'public' } = process.env;
const [email, motDePasse, nom = 'Superviseur'] = process.argv.slice(2);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !email || !motDePasse) {
  console.log('Usage : node creer-superviseur.js <email> <mot_de_passe> "<nom complet>"');
  console.log('Variables requises : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (et DB_SCHEMA si différent de public)');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, db: { schema: DB_SCHEMA } });

const { data, error } = await admin.auth.admin.createUser({ email: email.toLowerCase(), password: motDePasse, email_confirm: true, user_metadata: { nom_complet: nom } });
if (error) { console.error('Erreur :', error.message); process.exit(1); }
const { error: e2 } = await admin.from('profils').insert({ id: data.user.id, nom_complet: nom, role: 'superviseur' });
if (e2) { console.error('Compte créé mais profil en erreur :', e2.message); process.exit(1); }
console.log(`Superviseur créé : ${email}`);
