import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export const ROLES = {
  superviseur: 'Superviseur',
  iepp: 'Inspecteur (IEPP)',
  conseiller: 'Conseiller pédagogique',
  directeur: "Directeur d'école",
  saisie: 'Agent de saisie',
};

export function AppProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profil, setProfil] = useState(null);
  const [iepps, setIepps] = useState([]);
  const [ieppId, setIeppIdState] = useState(null);
  const [annee, setAnnee] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreurProfil, setErreurProfil] = useState('');
  const [abonnementActif, setAbonnementActif] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const recharger = useCallback(async () => {
    if (!session) {
      setProfil(null);
      setChargement(false);
      return;
    }
    setChargement(true);
    setErreurProfil('');
    const { data: p, error } = await supabase.from('profils').select('*').eq('id', session.user.id).maybeSingle();
    if (error || !p) {
      setErreurProfil(error?.message || "Aucun profil n'est associé à ce compte.");
      setProfil(null);
      setChargement(false);
      return;
    }
    if (!p.actif) {
      const { data: cfg } = await supabase.from('config_abonnement').select('contact').eq('id', 1).maybeSingle();
      const enAttente = /attente de validation/i.test(p.motif_blocage || '');
      setErreurProfil(`${p.motif_blocage || 'Ce compte est désactivé.'}${cfg?.contact && !enAttente ? ` Contact : ${cfg.contact}.` : ''}`);
      setProfil(null);
      setChargement(false);
      return;
    }
    setProfil(p);
    const { data: liste } = await supabase.from('iepp').select('*, drena(nom)').order('nom');
    setIepps(liste || []);
    let choisi = p.iepp_id;
    if (p.role === 'superviseur') {
      let memo = null;
      try { memo = localStorage.getItem('iepp_courant'); } catch { /* stockage indisponible */ }
      choisi = (liste || []).find((i) => i.id === memo)?.id || liste?.[0]?.id || null;
    }
    setIeppIdState(choisi);
    const { data: a } = await supabase.from('annees_scolaires').select('*').eq('active', true).maybeSingle();
    setAnnee(a || null);
    // Abonnement de l'année active (le superviseur n'est jamais bloqué)
    let actif = true;
    if (p.role !== 'superviseur' && p.iepp_id && a) {
      const { data: ok, error: e } = await supabase.rpc('abonnement_actif', { p_iepp: p.iepp_id });
      actif = e ? true : !!ok; // fonction absente (script 005 non lancé) : pas de blocage
    }
    setAbonnementActif(actif);
    setChargement(false);
  }, [session]);

  useEffect(() => { recharger(); }, [recharger]);

  /** Actualise toutes les données affichées, sans recharger la page. */
  const actualiser = useCallback(async () => {
    const { data: liste } = await supabase.from('iepp').select('*, drena(nom)').order('nom');
    if (liste) setIepps(liste);
    const { data: a } = await supabase.from('annees_scolaires').select('*').eq('active', true).maybeSingle();
    setAnnee(a || null);
    setVersion((v) => v + 1);
  }, []);

  const setIeppId = (id) => {
    setIeppIdState(id);
    try { localStorage.setItem('iepp_courant', id); } catch { /* ignore */ }
  };

  const iepp = iepps.find((i) => i.id === ieppId) || null;
  const role = profil?.role;
  const peutGerer = role === 'superviseur' || role === 'iepp';

  const valeur = {
    session, profil, role, iepps, iepp, ieppId, setIeppId, annee, chargement, erreurProfil,
    peutGerer, recharger, abonnementActif, actualiser, version,
    deconnexion: () => supabase.auth.signOut(),
  };
  return <Ctx.Provider value={valeur}>{children}</Ctx.Provider>;
}
