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
      setErreurProfil('Ce compte est désactivé.');
      setProfil(null);
      setChargement(false);
      return;
    }
    setProfil(p);
    const { data: liste } = await supabase.from('iepp').select('id, nom, drena_id, localite, logo_url, telephone, email, boite_postale, drena(nom)').order('nom');
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
    setChargement(false);
  }, [session]);

  useEffect(() => { recharger(); }, [recharger]);

  const setIeppId = (id) => {
    setIeppIdState(id);
    try { localStorage.setItem('iepp_courant', id); } catch { /* ignore */ }
  };

  const iepp = iepps.find((i) => i.id === ieppId) || null;
  const role = profil?.role;
  const peutGerer = role === 'superviseur' || role === 'iepp';

  const valeur = {
    session, profil, role, iepps, iepp, ieppId, setIeppId, annee, chargement, erreurProfil,
    peutGerer, recharger,
    deconnexion: () => supabase.auth.signOut(),
  };
  return <Ctx.Provider value={valeur}>{children}</Ctx.Provider>;
}
