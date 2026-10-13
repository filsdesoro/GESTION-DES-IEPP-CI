import { useCallback, useEffect, useState } from 'react';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';
import { OPTIONS } from './Formulaire.jsx';
import { ChoixEcoleClasse, fmt, nomComplet } from './Choix.jsx';
import { useInscrits } from './Eleves.jsx';
import { nomCourtComposition, useCompositions } from './Compositions.jsx';

export default function BilanAnnuel() {
  const { annee, ieppId, role } = useApp();
  const [vue, setVue] = useState('classe');
  return (
    <div>
      <h1>Bilan annuel</h1>
      <div className="onglets">
        <button className={vue === 'classe' ? 'actif' : ''} onClick={() => setVue('classe')}>Bilan d'une classe</button>
        {role !== 'directeur' && role !== 'saisie' && <button className={vue === 'circ' ? 'actif' : ''} onClick={() => setVue('circ')}>Synthèse de la circonscription</button>}
      </div>
      {vue === 'classe' ? <BilanClasse /> : <SyntheseCirc ieppId={ieppId} annee={annee} />}
    </div>
  );
}

function BilanClasse() {
  const { role } = useApp();
  const [choix, setChoix] = useState({ ecoleId: null, classeId: null });
  const [inscrits, recharger] = useInscrits(choix.classeId);
  const [toutes] = useCompositions();
  // La moyenne annuelle se calcule sur les compositions mensuelles (pas les examens blancs)
  const compos = toutes.filter((c) => c.type === 'mensuelle' || c.type === 'autre');
  const [res, setRes] = useState({});
  const [seuil, setSeuil] = useState(5);
  const [decisions, setDecisions] = useState({});
  const [msg, setMsg] = useState('');
  const modifiable = role !== 'conseiller';

  const charger = useCallback(async () => {
    if (!inscrits.length) { setRes({}); return; }
    const { data } = await supabase.from('resultats_composition').select('*').in('inscription_id', inscrits.map((i) => i.id));
    const r = {};
    (data || []).forEach((x) => { r[`${x.inscription_id}|${x.composition_id}`] = x; });
    setRes(r);
    setDecisions(Object.fromEntries(inscrits.map((i) => [i.id, i.decision || ''])));
  }, [inscrits]);
  useEffect(() => { charger(); }, [charger]);

  // Moyenne annuelle = moyenne des compositions où l'élève a une moyenne
  const lignes = inscrits.map((i) => {
    const moys = compos.map((c) => res[`${i.id}|${c.id}`]?.moyenne).filter((m) => m !== null && m !== undefined).map(Number);
    const ma = moys.length ? Math.round((moys.reduce((a, b) => a + b, 0) / moys.length) * 100) / 100 : null;
    return { i, ma };
  });
  const tries = [...lignes].filter((l) => l.ma !== null).sort((a, b) => b.ma - a.ma);
  const rangs = {};
  tries.forEach((l, k) => { rangs[l.i.id] = k > 0 && tries[k - 1].ma === l.ma ? rangs[tries[k - 1].i.id] : k + 1; });

  function proposer() {
    setDecisions(Object.fromEntries(lignes.map((l) => [l.i.id, l.ma === null ? '' : l.ma >= seuil ? 'admis' : 'redouble'])));
    setMsg('Décisions proposées selon le seuil — vérifiez puis enregistrez.');
  }

  async function enregistrer() {
    setMsg('');
    for (const l of lignes) {
      const { error } = await supabase.from('inscriptions').update({
        moyenne_annuelle: l.ma, rang_annuel: rangs[l.i.id] || null, decision: decisions[l.i.id] || null,
      }).eq('id', l.i.id);
      if (error) return setMsg(traduireErreur(error));
    }
    setMsg('Bilan de la classe enregistré.');
    recharger();
  }

  const compte = (d) => Object.values(decisions).filter((x) => x === d).length;

  return (
    <>
      <ChoixEcoleClasse valeur={choix} changer={setChoix} />
      {choix.classeId && (
        <>
          <div className="barre-outils">
            <label className="en-ligne">Seuil de passage <input className="petit" type="number" step="0.5" value={seuil} onChange={(e) => setSeuil(Number(e.target.value))} /> /10</label>
            {modifiable && <button className="btn-contour" onClick={proposer}>Proposer les décisions</button>}
            <div className="espace" />
            <span className="discret">Admis : {compte('admis')} · Redoublants : {compte('redouble')} · Abandons : {compte('abandon')}</span>
            <button className="btn-contour" onClick={() => window.print()}>Imprimer</button>
            {modifiable && <button className="btn" onClick={enregistrer}>Enregistrer le bilan</button>}
          </div>
          {msg && <p className="succes">{msg}</p>}
          <div className="tableau-cadre">
            <table className="tableau">
              <thead><tr><th>N°</th><th>Élève</th>{compos.map((c) => <th key={c.id}>{nomCourtComposition(c)}</th>)}<th>Moy. annuelle</th><th>Rang</th><th>Décision</th></tr></thead>
              <tbody>
                {lignes.length === 0 && <tr><td colSpan={compos.length + 5} className="vide">Aucun élève.</td></tr>}
                {lignes.map(({ i, ma }, n) => (
                  <tr key={i.id}>
                    <td>{n + 1}</td>
                    <td className="nom">{nomComplet(i.eleves)}</td>
                    {compos.map((c) => <td key={c.id}>{fmt(res[`${i.id}|${c.id}`]?.moyenne)}</td>)}
                    <td><b>{fmt(ma)}</b></td>
                    <td>{rangs[i.id] || ''}</td>
                    <td>
                      <select disabled={!modifiable} value={decisions[i.id] || ''} onChange={(e) => setDecisions((d) => ({ ...d, [i.id]: e.target.value }))}>
                        <option value="">—</option>
                        {OPTIONS.decision.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function SyntheseCirc({ ieppId, annee }) {
  const [lignes, setLignes] = useState([]);
  useEffect(() => {
    if (!ieppId || !annee) return;
    supabase.from('v_bilan_annuel').select('*').eq('iepp_id', ieppId).eq('annee', annee.libelle).order('ecole').then(({ data }) => setLignes(data || []));
  }, [ieppId, annee]);
  const parNiveau = {};
  lignes.forEach((l) => {
    const p = parNiveau[l.niveau_code] || { inscrits: 0, admis: 0, redoublants: 0, abandons: 0 };
    ['inscrits', 'admis', 'redoublants', 'abandons'].forEach((k) => { p[k] += l[k]; });
    parNiveau[l.niveau_code] = p;
  });
  const ordre = ['PS', 'MS', 'GS', 'CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];
  const pct = (a, b) => (b ? `${fmt((100 * a) / b, 1)} %` : '');
  return (
    <>
      <div className="barre-outils"><div className="espace" /><button className="btn-contour" onClick={() => window.print()}>Imprimer</button></div>
      <h2>Par niveau</h2>
      <div className="tableau-cadre">
        <table className="tableau">
          <thead><tr><th>Niveau</th><th>Inscrits</th><th>Admis</th><th>Redoublants</th><th>Abandons</th><th>Taux de passage</th><th>Taux de redoublement</th></tr></thead>
          <tbody>
            {ordre.filter((n) => parNiveau[n]).map((n) => {
              const p = parNiveau[n];
              return <tr key={n}><td><b>{n}</b></td><td>{p.inscrits}</td><td>{p.admis}</td><td>{p.redoublants}</td><td>{p.abandons}</td><td>{pct(p.admis, p.inscrits)}</td><td>{pct(p.redoublants, p.inscrits)}</td></tr>;
            })}
            {!Object.keys(parNiveau).length && <tr><td colSpan={7} className="vide">Aucun bilan enregistré pour cette année.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>Par école</h2>
      <div className="tableau-cadre">
        <table className="tableau">
          <thead><tr><th>École</th><th>Niveau</th><th>Inscrits</th><th>Admis</th><th>Redoublants</th><th>Abandons</th><th>Taux de passage</th></tr></thead>
          <tbody>
            {lignes.map((l) => <tr key={`${l.ecole_id}${l.niveau_code}`}><td>{l.ecole}</td><td>{l.niveau_code}</td><td>{l.inscrits}</td><td>{l.admis}</td><td>{l.redoublants}</td><td>{l.abandons}</td><td>{l.taux_passage !== null ? `${fmt(l.taux_passage, 1)} %` : ''}</td></tr>)}
          </tbody>
        </table>
      </div>
    </>
  );
}
