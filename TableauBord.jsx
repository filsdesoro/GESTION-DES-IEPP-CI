import { useCallback, useEffect, useState } from 'react';
import { useApp } from './contexte.jsx';
import { API_URL, supabase } from './supabase';

function Etat({ titre, sous, etat, texteOk, texteKo }) {
  const cls = etat === null ? 'attente' : etat ? 'ok' : 'ko';
  return (
    <div className="carte etat">
      <div>
        <h3>{titre}</h3>
        <p className="discret">{sous}</p>
      </div>
      <div className={`voyant ${cls}`}><span />{etat === null ? 'Vérification…' : etat ? texteOk : texteKo}</div>
    </div>
  );
}

export default function TableauBord() {
  const { ieppId, iepp, annee, role } = useApp();
  const [serveur, setServeur] = useState(null);
  const [base, setBase] = useState(null);
  const [stats, setStats] = useState(null);

  const verifier = useCallback(async () => {
    setServeur(null);
    setBase(null);
    if (API_URL) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 60000); // Render gratuit peut mettre ~50 s à se réveiller
        const r = await fetch(API_URL + '/health', { signal: ctrl.signal });
        clearTimeout(t);
        setServeur(r.ok);
      } catch { setServeur(false); }
    } else setServeur(false);
    const { error } = await supabase.from('niveaux').select('code').limit(1);
    setBase(!error);
  }, []);

  useEffect(() => { verifier(); }, [verifier]);

  useEffect(() => {
    if (!ieppId) return;
    supabase.from('v_stats_iepp').select('*').eq('iepp_id', ieppId).maybeSingle().then(({ data }) => setStats(data));
  }, [ieppId]);

  const chiffres = stats && (role === 'superviseur' || role === 'iepp' || role === 'conseiller') ? [
    ['Écoles', stats.nb_ecoles],
    ['Secteurs', stats.nb_secteurs],
    ['Classes', stats.nb_classes],
    ['Élèves', stats.nb_eleves],
    ['dont filles', stats.nb_filles],
    ['Personnel', stats.nb_personnel],
  ] : null;

  return (
    <div>
      <h1>Tableau de bord</h1>
      {iepp && <p className="sous-titre">{iepp.nom}{annee ? ` — année scolaire ${annee.libelle}` : ''}</p>}
      {chiffres && (
        <div className="chiffres">
          {chiffres.map(([l, v]) => (
            <div key={l} className="chiffre"><b>{Number(v || 0).toLocaleString('fr-FR')}</b><span>{l}</span></div>
          ))}
        </div>
      )}
      <div className="pile-etats">
        <Etat titre="Site" sous="Hébergé sur Vercel" etat texteOk="En ligne" />
        {API_URL && <Etat titre="Serveur" sous="Hébergé sur Render" etat={serveur} texteOk="Connecté" texteKo="Injoignable" />}
        <Etat titre="Base de données" sous="Hébergée sur Supabase" etat={base} texteOk="Connectée" texteKo="Injoignable" />
      </div>
      <button className="btn" onClick={verifier}>Vérifier à nouveau</button>
    </div>
  );
}
