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
  const [statuts, setStatuts] = useState(null);
  const [cycles, setCycles] = useState(null);

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
    supabase.from('ecoles').select('statut').eq('iepp_id', ieppId).eq('actif', true).then(({ data }) => {
      const c = { public: 0, prive_laic: 0, prive_confessionnel: 0, communautaire: 0 };
      (data || []).forEach((e) => { c[e.statut] = (c[e.statut] || 0) + 1; });
      setStatuts(c);
    });
    if (annee) {
      Promise.all([
        supabase.from('niveaux').select('code, cycle'),
        supabase.from('classes').select('niveau_code, ecoles!inner(iepp_id)').eq('annee_id', annee.id).eq('ecoles.iepp_id', ieppId),
      ]).then(([n, c]) => {
        if (n.error || c.error) return setCycles(null);
        const cycle = Object.fromEntries((n.data || []).map((x) => [x.code, x.cycle]));
        const t = { primaire: 0, prescolaire: 0 };
        (c.data || []).forEach((x) => { t[cycle[x.niveau_code] === 'prescolaire' ? 'prescolaire' : 'primaire'] += 1; });
        setCycles(t);
      });
    }
  }, [ieppId, annee]);

  const chiffres = stats && (role === 'superviseur' || role === 'iepp' || role === 'conseiller') ? [
    ['Secteurs', stats.nb_secteurs],
    ...(cycles ? [['Classes primaires', cycles.primaire], ['Classes maternelles', cycles.prescolaire]] : [['Classes', stats.nb_classes]]),
    ['Personnel', stats.nb_personnel],
  ] : null;

  return (
    <div>
      <h1>Tableau de bord</h1>
      {iepp && <p className="sous-titre">{iepp.nom}{annee ? ` — année scolaire ${annee.libelle}` : ''}</p>}
      {chiffres && (
        <div className="chiffres">
          <Effectif total={Number(stats.nb_eleves || 0)} filles={Number(stats.nb_filles || 0)} />
          {statuts && <Ecoles c={statuts} />}
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

function Ecoles({ c }) {
  const privees = c.prive_laic + c.prive_confessionnel;
  const total = c.public + privees + c.communautaire;
  const pc = (n) => (total ? `${Math.round((1000 * n) / total) / 10}`.replace('.', ',') + ' %' : '—');
  const largeur = (n) => (total ? `${(100 * n) / total}%` : '0%');
  return (
    <div className="chiffre effectif">
      <div className="effectif-tete"><b>{total.toLocaleString('fr-FR')}</b><span>Écoles (total)</span></div>
      <div className="effectif-barre" aria-hidden="true">
        <i className="pub" style={{ width: largeur(c.public) }} />
        <i className="priv" style={{ width: largeur(privees) }} />
        <i className="com" style={{ width: largeur(c.communautaire) }} />
      </div>
      <div className="effectif-detail">
        <span><i className="pastille pub" /> Publiques <b>{c.public}</b> <small>{pc(c.public)}</small></span>
        <span><i className="pastille priv" /> Privées <b>{privees}</b> <small>{pc(privees)}{privees ? ` — ${c.prive_laic} laïque(s), ${c.prive_confessionnel} confessionnelle(s)` : ''}</small></span>
        {c.communautaire > 0 && <span><i className="pastille com" /> Communautaires <b>{c.communautaire}</b> <small>{pc(c.communautaire)}</small></span>}
      </div>
    </div>
  );
}
