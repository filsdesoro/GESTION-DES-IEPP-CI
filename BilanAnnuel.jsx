import { useCallback, useEffect, useState } from 'react';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';
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
  const { role, iepp } = useApp();
  const [choix, setChoix] = useState({ ecoleId: null, classeId: null });
  const [inscrits, recharger] = useInscrits(choix.classeId);
  const [compos] = useCompositionsMensuelles();
  const [res, setRes] = useState({});
  const [seuil, setSeuil] = useState(5);
  const [seuilEnregistre, setSeuilEnregistre] = useState(5);
  const [msg, setMsg] = useState({ t: '', ok: true });
  const [calcul, setCalcul] = useState(false);
  const modifiable = role !== 'conseiller';
  const peutSeuil = role === 'superviseur' || role === 'iepp';

  useEffect(() => { const s = Number(iepp?.seuil_passage ?? 5); setSeuil(s); setSeuilEnregistre(s); }, [iepp]);

  const chargerRes = useCallback(async () => {
    if (!inscrits.length) { setRes({}); return; }
    const { data } = await supabase.from('resultats_composition').select('*').in('inscription_id', inscrits.map((i) => i.id));
    const r = {};
    (data || []).forEach((x) => { r[`${x.inscription_id}|${x.composition_id}`] = x; });
    setRes(r);
  }, [inscrits]);
  useEffect(() => { chargerRes(); }, [chargerRes]);

  async function recalculer(silencieux = false) {
    if (!choix.classeId) return;
    setCalcul(true);
    const { error } = await supabase.rpc('calculer_bilan_classe', { p_classe: choix.classeId });
    setCalcul(false);
    if (error) return setMsg({ t: traduireErreur(error), ok: false });
    if (!silencieux) setMsg({ t: 'Bilan recalculé.', ok: true });
    recharger();
  }

  // À l'ouverture d'une classe, le bilan est recalculé automatiquement
  useEffect(() => { if (choix.classeId) recalculer(true); }, [choix.classeId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function enregistrerSeuil() {
    const { error } = await supabase.from('iepp').update({ seuil_passage: seuil }).eq('id', iepp.id);
    if (error) return setMsg({ t: traduireErreur(error), ok: false });
    setSeuilEnregistre(Number(seuil));
    await recalculer(true);
    setMsg({ t: `Seuil de passage fixé à ${fmt(seuil, 2)}/10 pour la circonscription. Décisions recalculées.`, ok: true });
  }

  async function exception(i, valeur) {
    // Abandon, exclusion, transfert : saisis à la main. Vide = décision automatique.
    const { error } = await supabase.from('inscriptions').update({ decision: valeur || null }).eq('id', i.id);
    if (error) return setMsg({ t: traduireErreur(error), ok: false });
    await recalculer(true);
  }

  const lignes = [...inscrits].sort((a, b) => (a.rang_annuel ?? 9999) - (b.rang_annuel ?? 9999) || nomComplet(a.eleves).localeCompare(nomComplet(b.eleves)));
  const compte = (d) => inscrits.filter((i) => i.decision === d).length;
  const libDecision = { admis: 'Admis', redouble: 'Redouble', exclu: 'Exclu', abandon: 'Abandon', transfere: 'Transféré' };

  return (
    <>
      <ChoixEcoleClasse valeur={choix} changer={setChoix} />
      {choix.classeId && (
        <>
          <div className="barre-outils">
            <label className="en-ligne">Seuil de passage
              <input className="petit" type="number" step="0.25" min="0" max="10" value={seuil} disabled={!peutSeuil} onChange={(e) => setSeuil(Number(e.target.value))} /> /10
            </label>
            {peutSeuil && Number(seuil) !== Number(seuilEnregistre) && <button className="btn-contour" onClick={enregistrerSeuil}>Appliquer le seuil</button>}
            <div className="espace" />
            <span className="discret">Admis : {compte('admis')} · Redoublants : {compte('redouble')} · Abandons : {compte('abandon')}</span>
            <button className="btn-contour" disabled={calcul} onClick={() => recalculer(false)}>{calcul ? 'Calcul…' : 'Recalculer'}</button>
            <button className="btn-contour" onClick={() => window.print()}>Imprimer</button>
          </div>
          <p className="discret non-imprime">La moyenne annuelle (moyenne des compositions mensuelles), le rang et la décision sont calculés automatiquement à chaque enregistrement de notes. Seuls les cas particuliers (abandon, exclusion, transfert) se saisissent à la main.</p>
          {msg.t && <p className={msg.ok ? 'succes' : 'erreur'}>{msg.t}</p>}
          <div className="tableau-cadre">
            <table className="tableau">
              <thead><tr><th>Rang</th><th>Élève</th>{compos.map((c) => <th key={c.id}>{nomCourtComposition(c)}</th>)}<th>Moy. annuelle</th><th>Décision</th>{modifiable && <th className="non-imprime">Cas particulier</th>}</tr></thead>
              <tbody>
                {lignes.length === 0 && <tr><td colSpan={compos.length + 5} className="vide">Aucun élève.</td></tr>}
                {lignes.map((i) => {
                  const auto = ['admis', 'redouble'].includes(i.decision) || !i.decision;
                  return (
                    <tr key={i.id}>
                      <td>{i.rang_annuel ? `${i.rang_annuel}${i.rang_annuel === 1 ? 'er' : 'e'}` : ''}</td>
                      <td className="nom">{nomComplet(i.eleves)}</td>
                      {compos.map((c) => <td key={c.id}>{fmt(res[`${i.id}|${c.id}`]?.moyenne)}</td>)}
                      <td><b>{fmt(i.moyenne_annuelle)}</b></td>
                      <td>{i.decision ? <span className={`badge ${i.decision === 'admis' ? 'vert' : i.decision === 'redouble' ? 'orange' : 'gris'}`}>{libDecision[i.decision]}</span> : <span className="discret">—</span>}</td>
                      {modifiable && (
                        <td className="non-imprime">
                          <select value={auto ? '' : i.decision} onChange={(e) => exception(i, e.target.value)}>
                            <option value="">Automatique</option>
                            <option value="abandon">Abandon</option>
                            <option value="exclu">Exclu</option>
                            <option value="transfere">Transféré</option>
                          </select>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/** Compositions prises en compte dans la moyenne annuelle (mensuelles + autres). */
function useCompositionsMensuelles() {
  const [toutes, charger] = useCompositions();
  return [toutes.filter((c) => c.type === 'mensuelle' || c.type === 'autre'), charger];
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
