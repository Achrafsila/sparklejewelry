import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import useSWR from 'swr';
import { todayIso } from '../../lib/dates';
import { messageFor, toAppError, type AppError } from '../../lib/errors';
import { centsToInput, formatMoney, parseMoney } from '../../lib/money';
import { callRpc, read } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { Button } from '../../ui/Button';
import { Segmented, Skeleton } from '../../ui/Controls';
import { InlineStatus, Notice } from '../../ui/Feedback';
import { Field } from '../../ui/Field';
import { MoneyField } from '../../ui/MoneyField';
import { PageHeader } from '../../ui/PageHeader';
import './dashboard.css';

interface Dashboard {
  delivered_count: number;
  items_revenue_cents: number;
  shipping_billed_cents: number;
  avg_basket_cents: number | null;
  cash_received_cents: number;
  expected_payouts_cents: number;
  returns: { count: number; rate: number; fees_cents: number };
  gaps_cents: number;
  margin: {
    items_revenue_cents: number;
    shipping_billed_cents: number;
    cogs_cents: number;
    transport_cents: number;
    packaging_cents: number;
    return_costs_cents: number;
    losses_cents: number;
    ad_spend_cents: number;
    estimated_cents: number;
  };
  missing: { code: 'packaging_unset' | 'ad_spend_missing' | 'variant_cost_unknown'; count: number }[];
  low_stock: { variant_id: string; sku: string; name: string; available_qty: number }[];
}

type Period = 'mois' | 'precedent' | '7j' | 'perso';

const iso = (d: Date) => d.toISOString().slice(0, 10);

function range(period: Period, from: string | null, to: string | null): [string, string] {
  const today = todayIso();
  const [y, m] = today.split('-').map(Number) as [number, number];
  if (period === 'precedent') return [iso(new Date(Date.UTC(y, m - 2, 1))), iso(new Date(Date.UTC(y, m - 1, 0)))];
  if (period === '7j') return [iso(new Date(Date.UTC(y, m - 1, Number(today.slice(8)) - 6))), today];
  if (period === 'perso' && from && to) return [from, to];
  return [`${today.slice(0, 7)}-01`, iso(new Date(Date.UTC(y, m, 0)))];
}

const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}T00:00:00Z`));

function monthsOf(from: string, to: string): string[] {
  const months: string[] = [];
  const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  while (iso(d) <= to) {
    months.push(iso(d));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return months;
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <tr>
      <th scope="row">
        {label}
        {hint && <span className="kpi__hint">{hint}</span>}
      </th>
      <td className="num">{value}</td>
    </tr>
  );
}

function BudgetForm({ months, onSaved }: { months: string[]; onSaved(): void }) {
  const budgets = useSWR<{ month: string; amount_cents: number }[], AppError>(['ad_spend', ...months], () =>
    read(supabase.from('ad_spend').select('month, amount_cents').in('month', months)),
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ state: 'idle' | 'success' | 'error'; text: string }>({ state: 'idle', text: '' });
  const [pending, setPending] = useState(false);
  const current = (m: string) => values[m] ?? centsToInput(budgets.data?.find((b) => b.month === m)?.amount_cents);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const rows = months.filter((m) => current(m).trim() !== '').map((m) => ({ month: m, amount_cents: parseMoney(current(m)) }));
    if (rows.some((r) => r.amount_cents === null)) {
      setStatus({ state: 'error', text: 'Montant invalide. Exemple : 300 ou 1 250,50.' });
      return;
    }
    setPending(true);
    try {
      await read(supabase.from('ad_spend').upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() }))).select('month'));
      setStatus({ state: 'success', text: 'Budget enregistré.' });
      await budgets.mutate();
      onSaved();
    } catch (err) {
      setStatus({ state: 'error', text: messageFor(toAppError(err)) });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="budget" onSubmit={onSubmit} noValidate>
      <div className="form-grid form-grid--2">
        {months.map((m) => (
          <MoneyField key={m} label={`Budget publicitaire de ${monthLabel(m)}`} value={current(m)} onChange={(v) => setValues((s) => ({ ...s, [m]: v }))} />
        ))}
      </div>
      <div>
        <Button type="submit" pending={pending}>
          Enregistrer le budget
        </Button>
        <InlineStatus state={status.state}>{status.text}</InlineStatus>
      </div>
    </form>
  );
}

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const period = (params.get('periode') as Period | null) ?? 'mois';
  const channel = params.get('canal') ?? '';
  const [from, to] = range(period, params.get('du'), params.get('au'));
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const data = useSWR<Dashboard, AppError>(['dashboard', from, to, channel], () =>
    callRpc<Dashboard>('dashboard', { p_from: from, p_to: to, p_channel: channel || null }),
  );
  const d = data.data;
  const months = monthsOf(from, to);

  const missingText = (m: Dashboard['missing'][number]) => {
    if (m.code === 'packaging_unset')
      return (
        <>
          Coût d’emballage par colis non réglé ({m.count} colis concerné{m.count > 1 ? 's' : ''}). <Link to="/reglages">Régler</Link>
        </>
      );
    if (m.code === 'ad_spend_missing') return <>Budget publicitaire non saisi pour {m.count} mois de la période.</>;
    return (
      <>
        {m.count} référence{m.count > 1 ? 's' : ''} sans coût d’achat connu (import du prototype). Un réassort fixera leur coût.
      </>
    );
  };

  return (
    <>
      <PageHeader
        title="Pilotage"
        filters={
          <>
            <Segmented<Period>
              label="Période"
              value={period}
              onChange={(p) => update({ periode: p === 'mois' ? '' : p, ...(p === 'perso' ? { du: from, au: to } : { du: '', au: '' }) })}
              options={[
                { value: 'mois', label: 'Ce mois' },
                { value: 'precedent', label: 'Mois précédent' },
                { value: '7j', label: '7 jours' },
                { value: 'perso', label: 'Personnalisée' },
              ]}
            />
            <label className="visually-hidden" htmlFor="dashboard-channel">
              Canal
            </label>
            <select id="dashboard-channel" className="select select--compact" value={channel} onChange={(e) => update({ canal: e.target.value })}>
              <option value="">Tous les canaux</option>
              <option value="instagram">Instagram</option>
              <option value="site">Site</option>
            </select>
            {period === 'perso' && (
              <div className="period-dates">
                <Field label="Du">{(p) => <input {...p} className="input" type="date" value={from} onChange={(e) => update({ du: e.target.value })} />}</Field>
                <Field label="Au">{(p) => <input {...p} className="input" type="date" value={to} onChange={(e) => update({ au: e.target.value })} />}</Field>
              </div>
            )}
          </>
        }
      />
      {data.error ? (
        <Notice tone="err" title={messageFor(data.error)}>
          <p>
            <Button size="small" onClick={() => data.mutate()}>
              Réessayer
            </Button>
          </p>
        </Notice>
      ) : !d ? (
        <Skeleton rows={6} label="Calcul des indicateurs" />
      ) : (
        <div className="dashboard">
          <section className="panel" aria-labelledby="kpi-title">
            <h2 id="kpi-title" className="panel__title">
              Ventes et encaissements
            </h2>
            <table className="kpi">
              <tbody>
                <Row label="Commandes livrées" value={String(d.delivered_count)} />
                <Row label="Bijoux vendus" value={formatMoney(d.items_revenue_cents)} hint="commandes livrées" />
                <Row label="Frais de livraison facturés" value={formatMoney(d.shipping_billed_cents)} />
                <Row label="Panier moyen" value={d.avg_basket_cents != null ? formatMoney(d.avg_basket_cents) : '—'} hint="bijoux seuls" />
                <Row label="Montants encaissés" value={formatMoney(d.cash_received_cents)} hint="versements reçus" />
                <Row label="Versements attendus" value={formatMoney(d.expected_payouts_cents)} hint="à ce jour, net des frais" />
                <Row
                  label="Retours"
                  value={`${d.returns.count} (${Math.round(d.returns.rate * 100)} %)`}
                  hint={`frais de retour ${formatMoney(d.returns.fees_cents)}`}
                />
                <Row label="Écarts de versement" value={formatMoney(d.gaps_cents)} />
              </tbody>
            </table>
          </section>

          <section className="panel" aria-labelledby="low-title">
            <h2 id="low-title" className="panel__title">
              Références en stock bas
            </h2>
            {d.low_stock.length === 0 ? (
              <p className="muted">Aucune référence sous le seuil d’alerte.</p>
            ) : (
              <ul className="plain-list">
                {d.low_stock.map((s) => (
                  <li key={s.variant_id} className="plain-list__row">
                    <Link to={`/stock/${s.variant_id}`}>{s.name}</Link>
                    <span className="num">
                      {s.available_qty} disponible{s.available_qty > 1 ? 's' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel dashboard__margin" aria-labelledby="margin-title">
            {d.missing.length > 0 && (
              <Notice tone="warn" title="Coûts manquants">
                <ul className="missing-list">
                  {d.missing.map((m) => (
                    <li key={m.code}>{missingText(m)}</li>
                  ))}
                </ul>
                <p>La marge ci-dessous est incomplète tant que ces coûts manquent.</p>
              </Notice>
            )}
            <h2 id="margin-title" className="panel__title">
              Marge estimée
            </h2>
            <p className="muted">
              Coût des pièces au coût moyen pondéré, figé à l’expédition. Transport réel compté par colis.
            </p>
            <table className="kpi kpi--margin">
              <tbody>
                <Row label="Prix des bijoux" value={formatMoney(d.margin.items_revenue_cents)} />
                <Row label="Frais de livraison facturés" value={formatMoney(d.margin.shipping_billed_cents)} />
                <Row label="Coût des pièces vendues" value={formatMoney(-d.margin.cogs_cents)} />
                <Row label="Transport réel" value={formatMoney(-d.margin.transport_cents)} />
                <Row label="Emballage" value={formatMoney(-d.margin.packaging_cents)} />
                <Row label="Coûts des retours" value={formatMoney(-d.margin.return_costs_cents)} hint="transport, frais, emballage" />
                <Row label="Pièces abîmées" value={formatMoney(-d.margin.losses_cents)} />
                {channel ? (
                  <tr>
                    <th scope="row" colSpan={2} className="muted">
                      Budget publicitaire de la période : non réparti entre les canaux.
                    </th>
                  </tr>
                ) : (
                  <Row label="Budget publicitaire" value={formatMoney(-d.margin.ad_spend_cents)} hint="de la période" />
                )}
                <tr className="kpi__total">
                  <th scope="row">Marge estimée</th>
                  <td className="num">{formatMoney(d.margin.estimated_cents)}</td>
                </tr>
              </tbody>
            </table>
            <h3 className="section-title">Budget publicitaire</h3>
            <BudgetForm months={months} onSaved={() => data.mutate()} />
          </section>
        </div>
      )}
    </>
  );
}
