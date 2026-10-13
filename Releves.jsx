import { useEffect, useState } from 'react';
import { useApp } from './contexte.jsx';
import { supabase } from './supabase';
import { ChoixEcoleClasse, dateFr, fmt, nomComplet, useEcoles } from './Choix.jsx';
import { useInscrits } from './Eleves.jsx';
import { ChoixComposition, libelleComposition, useCompositions } from './Compositions.jsx';
import { useBareme } from './SaisieNotes.jsx';

export function appreciation(m) {
  if (m === null || m === undefined) return '';
  const n = Number(m);
  if (n >= 9) return 'Excellent';
  if (n >= 8) return 'Très bien';
  if (n >= 7) return 'Bien';
  if (n >= 6) return 'Assez bien';
  if (n >= 5) return 'Passable';
  if (n >= 4) return 'Insuffisant';
  return 'Très insuffisant';
}

export function EnTeteOfficiel({ iepp, ecole, droite }) {
  return (
    <div className="entete-officiel">
      <div>
        <b>MINISTÈRE DE L'ÉDUCATION NATIONALE<br />ET DE L'ALPHABÉTISATION</b>
        <div>{iepp?.drena?.nom}</div>
        <div>{iepp?.nom}</div>
        {ecole && <div>{ecole.nom}</div>}
      </div>
      <div className="droite">
        <b>RÉPUBLIQUE DE CÔTE D'IVOIRE</b>
        <div className="devise">Union – Discipline – Travail</div>
        {droite}
      </div>
    </div>
  );
}

export default function Releves() {
  const { iepp, annee } = useApp();
  const [compos] = useCompositions();
  const [compoId, setCompoId] = useState('');
  const [choix, setChoix] = useState({ ecoleId: null, classeId: null });
  const [classe, setClasse] = useState(null);
  const [inscrits] = useInscrits(choix.classeId);
  const matieres = useBareme(classe?.niveau_code);
  const ecoles = useEcoles();
  const ecole = ecoles.find((e) => e.id === choix.ecoleId);
  const [notes, setNotes] = useState({});
  const [res, setRes] = useState({});

  useEffect(() => { if (!compoId && compos.length) setCompoId((compos.filter((c) => c.saisie_ouverte).pop() || compos[compos.length - 1]).id); }, [compos, compoId]);

  useEffect(() => {
    if (!compoId || !inscrits.length) { setNotes({}); setRes({}); return; }
    const ids = inscrits.map((i) => i.id);
    supabase.from('notes').select('*').eq('composition_id', compoId).in('inscription_id', ids).then(({ data }) => {
      const n = {};
      (data || []).forEach((x) => { n[`${x.inscription_id}|${x.matiere_id}`] = x; });
      setNotes(n);
    });
    supabase.from('resultats_composition').select('*').eq('composition_id', compoId).in('inscription_id', ids)
      .then(({ data }) => setRes(Object.fromEntries((data || []).map((x) => [x.inscription_id, x]))));
  }, [compoId, inscrits]);

  const compo = compos.find((c) => c.id === compoId);
  const sansResultat = inscrits.length > 0 && Object.keys(res).length === 0;

  return (
    <div>
      <h1 className="non-imprime">Relevés de notes</h1>
      <div className="non-imprime">
        <div className="choix-ligne">
          <ChoixComposition compos={compos} valeur={compoId} changer={setCompoId} />
        </div>
        <ChoixEcoleClasse valeur={choix} changer={(v, c) => { setChoix(v); setClasse(c); }} niveaux={compo?.niveaux} />
        {sansResultat && <p className="alerte">Les moyennes n'ont pas encore été calculées pour cette classe. Ouvrez la saisie des notes et cliquez sur « Enregistrer et calculer les moyennes ».</p>}
        {inscrits.length > 0 && <div className="barre-outils"><span className="discret">{inscrits.length} relevé(s)</span><div className="espace" /><button className="btn" onClick={() => window.print()}>Imprimer les relevés</button></div>}
      </div>

      {compo && classe && inscrits.map((i) => {
        const r = res[i.id];
        let total = 0;
        let totalMax = 0;
        return (
          <section key={i.id} className="document releve">
            <EnTeteOfficiel iepp={iepp} ecole={ecole} droite={<div>Année scolaire {annee?.libelle}</div>} />
            <h2 className="titre-doc">RELEVÉ DE NOTES — {libelleComposition(compo).toUpperCase()}</h2>
            <div className="infos-eleve">
              <div>Nom et prénoms : <b>{nomComplet(i.eleves)}</b></div>
              <div>Classe : <b>{classe.nom}</b></div>
              <div>Né(e) le : {dateFr(i.eleves.date_naissance)} {i.eleves.lieu_naissance ? `à ${i.eleves.lieu_naissance}` : ''}</div>
              <div>Matricule : {i.eleves.matricule || '—'}</div>
              <div>Sexe : {i.eleves.sexe}</div>
              <div>Statut : {i.statut === 'redoublant' ? 'Redoublant(e)' : 'Non redoublant(e)'}</div>
            </div>
            <table className="tableau doc">
              <thead><tr><th>Matières</th><th>Note</th><th>Sur</th><th>Coef.</th><th>Points</th></tr></thead>
              <tbody>
                {matieres.map((m) => {
                  const n = notes[`${i.id}|${m.id}`];
                  const pts = n && !n.absent && n.note !== null ? Number(n.note) * m.coefficient : null;
                  if (pts !== null) { total += pts; totalMax += m.note_sur * m.coefficient; }
                  return (
                    <tr key={m.id}>
                      <td>{m.libelle}</td>
                      <td>{n?.absent ? 'Abs' : fmt(n?.note, 2)}</td>
                      <td>{m.note_sur}</td>
                      <td>{m.coefficient}</td>
                      <td>{fmt(pts, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><td colSpan={4}><b>Total</b></td><td><b>{fmt(total, 2)} / {fmt(totalMax, 0)}</b></td></tr>
              </tfoot>
            </table>
            <div className="resultat-doc">
              <div>Moyenne : <b>{fmt(r?.moyenne)} / 10</b></div>
              <div>Rang : <b>{r?.rang ? `${r.rang}${r.rang === 1 ? 'er' : 'e'}` : '—'}</b> sur {inscrits.length}</div>
              <div>Appréciation : <b>{appreciation(r?.moyenne)}</b></div>
            </div>
            <div className="signatures">
              <div>Le maître</div>
              <div>Le directeur</div>
              <div>Signature du parent</div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
