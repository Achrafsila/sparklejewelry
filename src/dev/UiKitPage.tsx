// Local-stack only: a gallery of the UI kit used by tests/e2e/ui-kit.spec.ts.
import { useState } from 'react';
import { Button } from '../ui/Button';
import { Combobox } from '../ui/Combobox';
import { Checkbox, Segmented, Switch } from '../ui/Controls';
import { DataList } from '../ui/DataList';
import { InlineStatus, Notice } from '../ui/Feedback';
import { Field } from '../ui/Field';
import { MoneyField } from '../ui/MoneyField';
import { PageHeader } from '../ui/PageHeader';
import { PhotoSlot } from '../ui/PhotoSlot';
import { Sheet } from '../ui/Sheet';
import { StatusBadge } from '../ui/StatusBadge';

const sample =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' fill='%23C9B48A'/%3E%3Ccircle cx='20' cy='22' r='9' fill='none' stroke='%23fff' stroke-width='3'/%3E%3C/svg%3E";

const refs = [
  { id: '1', name: 'Bague Luna Or', sku: 'BAGUE-LUNA-OR', available: 4 },
  { id: '2', name: 'Bague Luna Argent', sku: 'BAGUE-LUNA-ARGENT', available: 12 },
  { id: '3', name: 'Collier Soleil', sku: 'COLLIER-SOLEIL', available: 0 },
];

export function UiKitPage() {
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(true);
  const [view, setView] = useState<'a' | 'b'>('a');

  return (
    <main className="app-main" style={{ marginLeft: 0 }}>
      <div className="app-main__inner" style={{ display: 'grid', gap: 24 }}>
        <PageHeader title="Composants" />
        <section className="panel form-grid form-grid--2">
          <Field label="Nom du modèle" hint="Exemple : Bague Luna">
            {(p) => <input {...p} className="input" placeholder="Nom affiché" value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <MoneyField label="Coût unitaire" value={cost} onChange={setCost} />
          <Field label="Transporteur">
            {(p) => (
              <select {...p} className="select" defaultValue="">
                <option value="">Choisir</option>
                <option>Amana</option>
                <option>Sendit</option>
              </select>
            )}
          </Field>
          <Field label="Note" optional>
            {(p) => <textarea {...p} className="textarea" placeholder="Remarque pour la préparation" />}
          </Field>
          <Combobox
            label="Rechercher une référence"
            items={refs}
            getKey={(r) => r.id}
            getText={(r) => `${r.name} ${r.sku}`}
            renderItem={(r) => (
              <span className="item-line">
                <PhotoSlot size={40} />
                <span className="item-line__text">
                  <span className="item-line__name">{r.name}</span>
                  <span className="item-line__meta">{r.sku}</span>
                </span>
              </span>
            )}
            onSelect={(r) => setSelected(r.sku)}
            placeholder="Nom ou référence"
          />
          <div>{selected && <p>Sélection : {selected}</p>}</div>
          <Checkbox label="Autoriser la même pièce plusieurs fois" />
          <Switch label="Instagram" checked={on} onChange={setOn} />
        </section>
        <section className="panel" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="primary">Valider</Button>
          <Button variant="primary" pending>
            Enregistrement
          </Button>
          <Button variant="secondary">Annuler</Button>
          <Button variant="danger">Supprimer</Button>
          <Button onClick={() => setOpen(true)}>Ouvrir le panneau</Button>
        </section>
        <section className="panel" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['en_livraison', 'livree', 'payee', 'retour_attendu', 'low', 'out'] as const).map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
          <PhotoSlot size={56} />
          <PhotoSlot size={56} preview={sample} alt="Bague Luna" selected />
        </section>
        <Segmented<'a' | 'b'>
          label="Vue"
          value={view}
          onChange={setView}
          options={[
            { value: 'a', label: 'Livraison en cours', count: 3 },
            { value: 'b', label: 'Livrée', count: 1 },
          ]}
        />
        <InlineStatus state="success">Ligne ajoutée à l’arrivage.</InlineStatus>
        <Notice tone="warn" title="Stock bas">
          <p>Bague Luna Or : 4 disponibles.</p>
        </Notice>
        <DataList
          label="Références de test"
          rows={refs}
          rowKey={(r) => r.id}
          columns={[
            { key: 'name', header: 'Modèle', render: (r) => r.name },
            { key: 'sku', header: 'Référence', render: (r) => r.sku },
            { key: 'available', header: 'Disponible', render: (r) => r.available, numeric: true },
          ]}
          renderCard={(r) => (
            <div className="card__row">
              <span>{r.name}</span>
              <b className="num">{r.available}</b>
            </div>
          )}
          empty={<p>Vide</p>}
        />
        <Sheet title="Fiche de test" open={open} onClose={() => setOpen(false)}>
          <p>Contenu du panneau.</p>
          <Button>Action dans le panneau</Button>
        </Sheet>
      </div>
    </main>
  );
}
