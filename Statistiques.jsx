import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { useApp } from './contexte.jsx';
import { supabase } from './supabase';
import { libelle } from './Formulaire.jsx';
import { fmt, useListe } from './Choix.jsx';

const ORDRE = ['PS', 'MS', 'GS', 'CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];

function grouper(lignes, cle) {
  const g = {};
  lignes.forEach((l) => {
    const k = cle(l) ?? '—';
    const x = g[k] || { garcons: 0, filles: 0, total: 0, redoublants: 0 };
    x.garcons += l.garcons; x.filles += l.filles; x.total += l.total; x.redoublants += l.redoublants;
    g[k] = x;
  });
  return g;
}

function TableGroupe({ titre, groupes, ordre, nomCle }) {
  const cles = ordre ? ordre.filter((k) => groupes[k]) : Object.keys(groupes).sort();
  const max = Math.max(1, ...cles.map((k) => groupes[k].total));
  const tot = cles.reduce((s, k) => ({ g: s.g + groupes[k].garcons, f: s.f + groupes[k].filles, t: s.t + groupes[k].total, r: s.r + groupes[k].redoublants }), { g: 0, f: 0, t: 0, r: 0 });
  return (
    <div className="carte">
      <h3>{titre}</h3>
      <table className="tableau">
        <thead><tr><th>{nomCle}</th><th>Garçons</th><th>Filles</th><th>Total</th><th>% filles</th><th>Redoublants</th><th className="non-imprime" style={{ width: '30%' }} /></tr></thead>
        <tbody>
          {cles.map((k) => {
            const x = groupes[k];
            return (
              <tr key={k}>
                <td><b>{k}</b></td><td>{x.garcons}</td><td>{x.filles}</td><td><b>{x.total}</b></td>
                <td>{x.total ? `${fmt((100 * x.filles) / x.total, 1)} %` : ''}</td><td>{x.redoublants}</td>
                <td className="non-imprime"><div className="barre"><span className="g" style={{ width: `${(100 * x.garcons) / max}%` }} /><span className="f" style={{ width: `${(100 * x.filles) / max}%` }} /></div></td>
              </tr>
            );
          })}
          {!cles.length && <tr><td colSpan={7} className="vide">Aucun élève inscrit.</td></tr>}
        </tbody>
        {cles.length > 0 && <tfoot><tr><td>Total</td><td>{tot.g}</td><td>{tot.f}</td><td>{tot.t}</td><td>{tot.t ? `${fmt((100 * tot.f) / tot.t, 1)} %` : ''}</td><td>{tot.r}</td><td className="non-imprime" /></tr></tfoot>}
      </table>
      <p className="legende non-imprime"><span className="pastille g" /> Garçons <span className="pastille f" /> Filles</p>
    </div>
  );
}

export default function Statistiques() {
  const { ieppId, iepp, annee, profil } = useApp();
  const [eff, setEff] = useState([]);
  const [stats, setStats] = useState(null);
  const [cepe, setCepe] = useState([]);
  const secteurs = useListe('secteurs', { filtre: { iepp_id: ieppId } });

  useEffect(() => {
    if (!ieppId) return;
    let q = supabase.from('v_effectifs').select('*').eq('iepp_id', ieppId);
    if (profil.role === 'conseiller') q = q.eq('secteur_id', profil.secteur_id);
    q.then(({ data }) => setEff(data || []));
    supabase.from('v_stats_iepp').select('*').eq('iepp_id', ieppId).maybeSingle().then(({ data }) => setStats(data));
    if (annee) supabase.from('v_resultats_cepe').select('*').eq('iepp_id', ieppId).eq('annee_id', annee.id).order('centre').then(({ data }) => setCepe(data || []));
  }, [ieppId, annee, profil]);

  const nomSecteur = (id) => secteurs.find((s) => s.id === id)?.nom || 'Sans secteur';
  const parNiveau = grouper(eff, (l) => l.niveau_code);
  const parStatut = grouper(eff, (l) => libelle('statut_ecole', l.statut));
  const parSecteur = grouper(eff, (l) => nomSecteur(l.secteur_id));
  const parEcole = grouper(eff, (l) => l.ecole);

  function exporter() {
    const wb = XLSX.utils.book_new();
    const feuille = (g) => Object.entries(g).map(([k, x]) => ({ Libellé: k, Garçons: x.garcons, Filles: x.filles, Total: x.total, Redoublants: x.redoublants }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(feuille(parNiveau)), 'Par niveau');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(feuille(parStatut)), 'Par statut');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(feuille(parSecteur)), 'Par secteur');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(feuille(parEcole)), 'Par école');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eff.map((l) => ({ École: l.ecole, Niveau: l.niveau_code, Garçons: l.garcons, Filles: l.filles, Total: l.total, Redoublants: l.redoublants }))), 'Détail');
    XLSX.writeFile(wb, `statistiques_${(iepp?.nom || 'iepp').replace(/\s+/g, '_')}_${annee?.libelle || ''}.xlsx`);
  }

  const ratioClasse = stats?.nb_classes ? stats.nb_eleves / stats.nb_classes : null;
  const ratioMaitre = stats?.nb_personnel ? stats.nb_eleves / stats.nb_personnel : null;

  return (
    <div>
      <div className="titre-ligne">
        <h1>Statistiques {annee ? annee.libelle : ''}</h1>
        <div className="non-imprime">
          <button className="btn-contour" onClick={exporter}>Exporter Excel</button>{' '}
          <button className="btn-contour" onClick={() => window.print()}>Imprimer</button>
        </div>
      </div>
      {stats && profil.role !== 'conseiller' && (
        <div className="chiffres">
          <div className="chiffre"><b>{stats.nb_ecoles}</b><span>Écoles ({stats.nb_ecoles_publiques} publiques)</span></div>
          <div className="chiffre"><b>{stats.nb_classes}</b><span>Classes</span></div>
          <div className="chiffre"><b>{Number(stats.nb_eleves).toLocaleString('fr-FR')}</b><span>Élèves</span></div>
          <div className="chiffre"><b>{stats.nb_eleves ? `${fmt((100 * stats.nb_filles) / stats.nb_eleves, 1)} %` : '—'}</b><span>Filles</span></div>
          <div className="chiffre"><b>{fmt(ratioClasse, 1) || '—'}</b><span>Élèves par classe</span></div>
          <div className="chiffre"><b>{fmt(ratioMaitre, 1) || '—'}</b><span>Élèves par agent</span></div>
        </div>
      )}
      <div className="pile">
        <TableGroupe titre="Effectifs par niveau" groupes={parNiveau} ordre={ORDRE} nomCle="Niveau" />
        <TableGroupe titre="Effectifs par statut d'école" groupes={parStatut} nomCle="Statut" />
        <TableGroupe titre="Effectifs par secteur pédagogique" groupes={parSecteur} nomCle="Secteur" />
        <TableGroupe titre="Effectifs par école" groupes={parEcole} nomCle="École" />
        {cepe.length > 0 && (
          <div className="carte">
            <h3>Résultats CEPE par centre</h3>
            <table className="tableau">
              <thead><tr><th>Centre</th><th>Candidats</th><th>Admis</th><th>Taux de réussite</th></tr></thead>
              <tbody>{cepe.map((c) => <tr key={c.centre_id}><td>{c.centre}</td><td>{c.candidats}</td><td>{c.admis}</td><td>{c.taux_reussite !== null ? `${fmt(c.taux_reussite, 1)} %` : ''}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
