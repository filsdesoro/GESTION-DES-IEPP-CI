import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://jhodmeqharekjutvvzcy.supabase.co';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_J62bQN4PzB8iX0lViwpxzg_Ex0CM-iz';
export const DB_SCHEMA = import.meta.env.VITE_DB_SCHEMA || 'public';
export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export const configOk = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_KEY || 'x', {
  db: { schema: DB_SCHEMA },
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Lève une erreur lisible si la requête Supabase a échoué. */
export function verifier({ data, error }) {
  if (error) throw new Error(traduireErreur(error));
  return data;
}

export function traduireErreur(error) {
  const m = error?.message || String(error);
  if (/row-level security/i.test(m)) return "Action non autorisée pour votre compte.";
  if (/duplicate key/i.test(m)) return 'Cet enregistrement existe déjà (doublon).';
  if (/violates foreign key/i.test(m)) return 'Impossible : cet élément est utilisé ailleurs.';
  if (/Invalid login credentials/i.test(m)) return 'Email ou mot de passe incorrect.';
  if (/Failed to fetch/i.test(m)) return 'Connexion impossible. Vérifiez votre accès Internet.';
  return m;
}

/** Appel authentifié au serveur Render. */
export async function api(chemin, options = {}) {
  if (!API_URL) throw new Error("Le serveur n'est pas configuré (VITE_API_URL).");
  const { data } = await supabase.auth.getSession();
  const rep = await fetch(API_URL + chemin, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session?.access_token || ''}`,
      ...(options.headers || {}),
    },
  });
  const corps = await rep.json().catch(() => ({}));
  if (!rep.ok) throw new Error(corps.erreur || `Erreur serveur (${rep.status})`);
  return corps;
}

export const uid = () => crypto.randomUUID();
