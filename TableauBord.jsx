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
    ['Personnel', stats.nb_personnel],
  ] : null;

  return (
    <div>
      <h1>Tableau de bord</h1>
      {iepp && <p className="sous-titre">{iepp.nom}{annee ? ` — année scolaire ${annee.libelle}` : ''}</p>}
      {chiffres && (
        <div className="chiffres">
          <Effectif total={Number(stats.nb_eleves || 0)} filles={Number(stats.nb_filles || 0)} />
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

function Effectif({ total, filles }) {
  const garcons = Math.max(total - filles, 0);
  const pc = (n) => (total ? `${Math.round((1000 * n) / total) / 10}`.replace('.', ',') + ' %' : '—');
  const nb = (n) => n.toLocaleString('fr-FR');
  return (
    <div className="chiffre effectif">
      <div className="effectif-tete"><b>{nb(total)}</b><span>Élèves (total)</span></div>
      <div className="effectif-barre" aria-hidden="true">
        <i className="g" style={{ width: total ? `${(100 * garcons) / total}%` : '50%' }} />
        <i className="f" style={{ width: total ? `${(100 * filles) / total}%` : '50%' }} />
      </div>
      <div className="effectif-detail">
        <span><i className="pastille g" /> Garçons <b>{nb(garcons)}</b> <small>{pc(garcons)}</small></span>
        <span><i className="pastille f" /> Filles <b>{nb(filles)}</b> <small>{pc(filles)}</small></span>
      </div>
    </div>
  );
}
