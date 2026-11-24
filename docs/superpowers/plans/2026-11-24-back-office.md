# Sparkle back-office — plan d'implémentation

> **Pour les agents :** sous-skill requise : superpowers:executing-plans (choisie, voir fin). Les étapes utilisent des cases `- [ ]`.

**But :** livrer le back-office Sparkle (Stock, Offres, Commandes, Préparation, Suivi, Pilotage, Réglages) sur une base Supabase partagée, avec des opérations de stock transactionnelles et une interface responsive « Liquid Glass ».

**Architecture :** SPA Vite + React + TypeScript servie statiquement par Vercel. Lectures via des vues Postgres (RLS admin) et SWR ; toutes les écritures qui touchent stock ou argent passent par des fonctions Postgres `SECURITY DEFINER`, transactionnelles, idempotentes (`p_request_id`). En local : Postgres 17 (Homebrew) + PostgREST + bouchons Auth/Storage montés dans le serveur Vite.

**Pile :** React 19.3, Vite 8.3, TypeScript 7.0, @supabase/supabase-js 2.119, SWR 2.5, react-router 8.5, lucide-react, @fontsource/instrument-sans + instrument-serif 5.3 ; Vitest 5.1, @playwright/test 1.65, pg 8.23 ; PostgREST 16.6 (Homebrew).

**Spec :** `docs/superpowers/specs/2026-11-24-back-office-design.md` (lire en entier avant toute tâche).

## Contraintes globales

- Langue d'interface : français. Montants stockés en **centimes entiers** ; affichage `Intl.NumberFormat('fr-MA', {style:'currency', currency:'MAD'})`.
- Saisie des montants : `15,50` | `15.50` | `15` acceptés ; >2 décimales, négatif, séparateurs multiples refusés.
- Seuil d'alerte par défaut : 5 ; alerte quand le disponible passe de `> seuil` à `<= seuil`.
- Statuts de commande (valeurs SQL) : `brouillon, confirmee, preparee, en_livraison, livree, payee, retour_attendu, retour_recu, annulee`. Libellés : Brouillon, Confirmée, Préparée, Livraison en cours, Livrée, Payée, Retour attendu, Retour reçu, Annulée.
- Numéro de commande : `SPK-` + 4 chiffres minimum (`SPK-0001`).
- Aucune écriture directe de `physical_qty`, `reserved_qty`, `avg_cost` depuis le client.
- Toute fonction métier commence par l'idempotence (`request_log`) puis `assert_admin()` (sauf `place_site_order` : `service_role`).
- Erreurs métier : `raise exception using errcode = 'P0001', message = '<CODE>', detail = <jsonb::text>`. Codes : `NON_AUTORISE, VALEUR_INVALIDE, SKU_EXISTE, MODELE_VARIANTE_EXISTE, STOCK_INSUFFISANT, ETAT_INVALIDE, PANIER_VIDE, OFFRE_INVALIDE, TRIO_INVALIDE, COMMANDE_DEJA_RATTACHEE, RETOUR_INCOHERENT, IMPORT_CONFLIT`.
- Interface claire uniquement, `color-scheme: light`. Verre seulement sur navigation, barre d'actions, panneaux flottants, notifications ; jamais derrière un champ ou un tableau.
- Pas de majuscules espacées, pas de chaînes « A · B · C », pas de flèche dans les boutons, cibles ≥ 44 px, champs en 16 px.
- Le bouchon Auth/Storage ne doit jamais être inclus dans `vite build`.
- Commits fréquents sur `feat/back-office`, message terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pas de push avant la Task 15.

## Points de vigilance (non couverts par les scénarios de la demande)

1. **Double clic / double onglet** sur « Confirmer », « Expédier », « Valider le retour » → une seule exécution. Test : `tests/db/idempotency.test.ts` (même `request_id` en parallèle) + E2E double clic (Task 13).
2. **Photo HEIC ou fichier non image** sur ordinateur → erreur sous le champ photo, saisie conservée. Test : `tests/e2e/arrivals.spec.ts › photo illisible`.
3. **Fermeture de l'onglet en pleine saisie** (arrivage, panier) → reprise à l'identique. Test : `arrivals.spec.ts › reprise après rechargement`, `orders.spec.ts › panier repris`.
4. **Téléphone saisi sous plusieurs formes** (`06 12 34 56 78`, `+212612345678`, `0612345678`) → même cliente. Test : `tests/unit/phone.test.ts` + `tests/db/customers.test.ts`.
5. **Versement saisi deux fois** ou commande déjà rattachée → refus explicite, aucun double « Payée ». Test : `tests/db/payouts.test.ts › commande déjà rattachée`.

---

## Carte des fichiers

```
package.json, tsconfig.json, vite.config.ts, vitest.config.ts, playwright.config.ts, eslint.config.js, vercel.json, index.html, .gitignore
.env.local-stack            VITE_SUPABASE_URL=http://localhost:5173, VITE_SUPABASE_ANON_KEY=<jeton anon dev>
dev/
  stack.sh                  start|stop|reset : initdb .local/pgdata (port 54329), PostgREST (port 54331)
  postgrest.conf
  auth-shim.sql             rôles anon/authenticated/service_role/authenticator, schéma auth, auth.uid(), auth.role()
  seed-dev.sql              admin de test (même uuid que dev/users.json) + réglages
  users.json                compte de test local (e-mail, mot de passe, uuid)
  supabase-stub.ts          plugin Vite (serve + mode local-stack) : /auth/v1, /storage/v1, proxy /rest/v1
  jwt.ts                    signHs256(payload, secret), verifyHs256(token, secret)
supabase/migrations/
  0001_schema.sql  0002_core.sql  0003_stock.sql  0004_orders.sql  0005_fulfilment.sql  0006_views.sql  0007_insights.sql  0008_rls.sql  0009_storage.sql
src/
  main.tsx, app/{router.tsx, AppLayout.tsx, Sidebar.tsx, BottomNav.tsx, ActionBar.tsx, RequireAuth.tsx}
  lib/{supabase.ts, rpc.ts, errors.ts, money.ts, phone.ts, sku.ts, drafts.ts, photo.ts, dates.ts, useRequest.ts}
  ui/{Button, Field, MoneyField, SelectField, Combobox, Checkbox, Switch, Sheet, Dialog, StatusBadge, PhotoSlot, DataList, Notice, InlineStatus, EmptyState, Skeleton, PageHeader, Segmented}.tsx
  styles/{tokens.css, base.css, forms.css, glass.css}
  features/
    auth/LoginPage.tsx
    stock/{StockPage.tsx, VariantSheet.tsx, useStock.ts}
    arrivals/{ArrivalPage.tsx, NewModelForm.tsx, ExistingModelForm.tsx, ArrivalSummary.tsx, arrivalDraft.ts}
    offers/{OffersPage.tsx, OfferSheet.tsx, TrioPicker.tsx, useOffers.ts}
    orders/{OrdersPage.tsx, NewOrderPage.tsx, CartStep.tsx, CustomerStep.tsx, ReviewStep.tsx, OrderSheet.tsx, cartDraft.ts}
    preparation/PreparationPage.tsx
    tracking/{TrackingPage.tsx, ReturnForm.tsx, PayoutPage.tsx, PayoutSheet.tsx}
    dashboard/DashboardPage.tsx
    settings/{SettingsPage.tsx, importPrototype.ts}
    search/GlobalSearch.tsx
tests/
  db/{setup.ts, helpers.ts, *.test.ts}    unit/*.test.ts    e2e/{fixtures.ts, *.spec.ts}
legacy/prototype.html       ancien index.html + bouton « Exporter (JSON) »
docs/{mise-en-service.md, boutique.md}
```

---

### Task 1: socle outillé et pile locale

**Fichiers :** créer `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js`, `.gitignore`, `dev/stack.sh`, `dev/postgrest.conf`, `dev/auth-shim.sql`, `tests/db/setup.ts`, `tests/db/helpers.ts`, `tests/db/smoke.test.ts` ; déplacer `index.html` → `legacy/prototype.html`.

**Interfaces produites :**
- Scripts npm : `db:start`, `db:stop`, `db:reset` (shim + migrations + seed-dev), `test:db`, `test:unit`, `test:e2e`, `dev` (= `vite --mode local-stack`), `build`, `lint`, `typecheck`.
- `tests/db/helpers.ts` : `freshDb(): Promise<{ pool: Pool; asAdmin(): Promise<PoolClient>; asAnon(): Promise<PoolClient>; drop(): Promise<void> }>` — clone la base modèle `sparkle_template` (construite une fois par `setup.ts` avec shim + migrations) ; `asAdmin` fixe `request.jwt.claims` (`sub` = ADMIN_ID, `role` = authenticated) et `set role authenticated`.
- `rpc(client, fn, args): Promise<any>` et `expectError(promise, code): Promise<{message, detail}>` dans `helpers.ts`.
- Constante `ADMIN_ID = '00000000-0000-4000-8000-000000000001'`.

- [ ] Installer PostgREST : `brew install postgrest` → `postgrest --version` affiche 16.x.
- [ ] Installer les dépendances aux versions de l'en-tête (`npm i` / `npm i -D`), puis `npx playwright install chromium webkit`.
- [ ] Écrire `tests/db/smoke.test.ts` : `select auth.uid()` en admin renvoie ADMIN_ID ; en anon renvoie null. Lancer `npm run test:db` → échec (pas de pile).
- [ ] Écrire `dev/stack.sh` (initdb dans `.local/pgdata`, `pg_ctl -o "-p 54329"`, PostgREST en arrière-plan avec log `.local/postgrest.log`), `dev/auth-shim.sql`, `setup.ts` (globalSetup Vitest : recrée `sparkle_template`).
- [ ] `npm run db:start && npm run test:db` → smoke PASS.
- [ ] Déplacer le prototype dans `legacy/prototype.html` et y ajouter un bouton « Exporter (JSON) » qui télécharge `localStorage['sparkle-back-office-v1']` (`sparkle-prototype-AAAA-MM-JJ.json`).
- [ ] `.gitignore` : `node_modules, dist, .local, .env*.local, .DS_Store, test-results, playwright-report`.
- [ ] Commit `chore: scaffold app, local Postgres/PostgREST stack and DB test harness`.

### Task 2: schéma, sécurité, idempotence

**Fichiers :** créer `supabase/migrations/0001_schema.sql`, `0002_core.sql`, `0008_rls.sql`, `dev/seed-dev.sql` ; test `tests/db/schema.test.ts`.

**Interfaces produites (SQL) :**
- Tables de la spec §6, plus `request_log(request_id uuid primary key, fn text not null, result jsonb, created_at timestamptz default now())`.
- Coûts unitaires moyens et figés en **centimes `numeric(12,4)`** : `variants.avg_cost`, `order_items.unit_cost`, `stock_movements.unit_cost`.
- `variants.available_qty` générée ; `check (reserved_qty >= 0 and reserved_qty <= physical_qty)` ; `sku` unique sur `upper(sku)` ; `unique (product_id, label_key)` où `label_key = norm_key(coalesce(label,''))`.
- `norm_key(text) returns text immutable` = minuscules + `unaccent` + espaces réduits ; index unique `products(norm_key(name))`.
- `is_admin() returns boolean`, `assert_admin()` (lève `NON_AUTORISE`).
- `begin_request(p_request_id uuid, p_fn text) returns jsonb` : insère la ligne (bloque si une transaction concurrente l'a déjà insérée) ; renvoie le `result` stocké si la demande existe déjà, sinon null. `finish_request(p_request_id uuid, p_result jsonb) returns jsonb` enregistre et renvoie le résultat.
- `settings` initialisée : seuil 5, emballage null, frais livraison null, `carriers = '{}'`.
- RLS activée partout ; politique `select` pour `is_admin()` ; écriture directe autorisée (admin) uniquement sur `offers` (hors suppression), `offer_items`, `customers`, `settings`, `ad_spend`. `revoke update (physical_qty, reserved_qty, avg_cost) on variants from authenticated`. Les fonctions sont `security definer set search_path = public, pg_temp`, `revoke execute ... from public, anon`, `grant ... to authenticated` (sauf `place_site_order` → `service_role` seulement).

- [ ] Tests (`schema.test.ts`) : anon ne lit rien dans `variants` ; un utilisateur authentifié non admin lit 0 ligne ; l'admin ne peut pas `update variants set physical_qty = 9` (erreur de permission) ; `begin_request` appelé deux fois avec le même uuid renvoie null puis le résultat stocké ; `norm_key('  Bagué  LUNA ') = 'bague luna'`.
- [ ] Lancer → FAIL ; écrire les migrations ; `npm run db:reset && npm run test:db` → PASS.
- [ ] Commit `feat(db): schema, RLS and request idempotency`.

### Task 3: arrivages, coût moyen, corrections

**Fichiers :** `supabase/migrations/0003_stock.sql` ; test `tests/db/arrivals.test.ts`.

**Interfaces produites :**
- `validate_receipt(p_request_id uuid, p_supplier text, p_received_on date, p_lines jsonb) returns jsonb` → `{receipt_id, variant_ids: uuid[]}`. Ligne : `{variant_id?: uuid, sku: text, product_name: text, label?: text, qty: int, unit_cost_cents: int, photo_path?: text}`.
- `adjust_stock(p_request_id uuid, p_variant_id uuid, p_delta int, p_reason text) returns jsonb` → `{variant_id, physical_qty, alerts}`.
- `suggest_sku(p_model text, p_label text) returns text` (même règle que `src/lib/sku.ts`, suffixe `-2`, `-3` si pris).
- `_lock_variants(p_ids uuid[])` (verrou `order by id for update`) ; `_alerts(p_before jsonb) returns jsonb` → `[{variant_id, sku, name, before, after, offers:[{id,name}]}]` pour les références passées de `> seuil` à `<= seuil`.
- Mouvement `arrivage` par ligne avec `unit_cost`.

- [ ] Tests :
  - `modèle sans variante` : ligne `{sku:'COLLIER-SOLEIL', product_name:'Collier Soleil', qty:10, unit_cost_cents:3000}` → 1 produit, 1 référence `label` null, physique 10, `avg_cost = 3000`.
  - `modèle avec plusieurs variantes` : Bague Luna Or (6) + Argent (4) dans le même arrivage → 1 produit, 2 références.
  - `nom existant + variante existante refusé` → `MODELE_VARIANTE_EXISTE`.
  - `SKU déjà pris` → `SKU_EXISTE` (insensible à la casse).
  - `réassort à un coût différent` : 10 à 3000 puis 10 à 3500 → physique 20, `avg_cost = 3250`, deux `receipt_lines` (3000 et 3500).
  - `coût 15,50` : `unit_cost_cents: 1550` → `receipt_lines.unit_cost_cents = 1550`.
  - `idempotence` : même `request_id` deux fois → un seul arrivage, physique inchangé au second appel.
  - `correction négative impossible sous le réservé` → `VALEUR_INVALIDE`.
  - `invariant` (helper `assertLedger(client)`) : pour chaque référence, `sum(physical_delta) = physical_qty` et `sum(reserved_delta) = reserved_qty`.
- [ ] FAIL → implémenter → PASS.
- [ ] Commit `feat(db): receipts with weighted average cost and stock corrections`.

### Task 4: offres, brouillons, confirmation, commandes du site

**Fichiers :** `supabase/migrations/0004_orders.sql` ; tests `tests/db/orders.test.ts`, `tests/db/concurrency.test.ts`, `tests/db/idempotency.test.ts`, `tests/db/customers.test.ts`.

**Interfaces produites :**
- `normalize_phone(text) returns text` → `+2126XXXXXXXX` / `+2127XXXXXXXX` / `+2125XXXXXXXX` ou null (même règle que `src/lib/phone.ts`).
- `save_order_draft(p_request_id uuid, p_order jsonb) returns jsonb` → `{order_id, number}`. Entrée : `{id?, customer:{name, phone, instagram?, city, address}, shipping_fee_cents, lines:[{offer_id, qty, variant_id?, picks?: uuid[]}]}`. Le serveur résout chaque ligne en `order_lines` + `order_items` (copie nom, format, prix ; à l'unité : `variant_id` obligatoire s'il y a plusieurs variantes, prix = `offer_items.price_cents` ou `offers.price_cents` ; trio fixe : composition × qty ; trio à composer : `qty` forcée à 1, 3 `picks` éligibles, doublons seulement si `allow_repeat`). Upsert `customers` par téléphone normalisé. Erreurs : `OFFRE_INVALIDE`, `TRIO_INVALIDE`, `VALEUR_INVALIDE`.
- `delete_draft(p_order_id uuid) returns void` (brouillon seulement).
- `confirm_order(p_request_id uuid, p_order_id uuid) returns jsonb` → `{order_id, status:'confirmee', alerts}`. `PANIER_VIDE` si aucune ligne ; `STOCK_INSUFFISANT` avec `detail = [{sku, name, need, available}]` (toutes les références en manque) ; si déjà `!= brouillon` : `ETAT_INVALIDE` avec `{status}`.
- `place_site_order(p_request_id uuid, p_order jsonb) returns jsonb` → `{order_id, number, status}` ; `channel='site'` ; n'accepte que les offres `on_site`.
- `order_needs(p_order_id uuid) returns table(variant_id uuid, qty int)`.

- [ ] Tests :
  - `trio fixe + unité additionnés` : stock Bronze 6 ; trio fixe {Bronze 1, Argent 1, Or 1} + Bronze à l'unité → besoin Bronze 2 ; après confirmation Bronze réservé 2, disponible 4 ; `alerts` contient Bronze `before 6 after 4` et les deux offres ; aucune offre n'est mise en pause (`on_instagram` inchangé).
  - `brouillon sans réservation` : `save_order_draft` → `reserved_qty` inchangé partout.
  - `trio à composer non disponible` : pick d'une référence à 0 disponible → `STOCK_INSUFFISANT` à la confirmation avec son `sku`, `need 1`, `available 0` ; pick non éligible → `TRIO_INVALIDE` au brouillon ; doublon sans `allow_repeat` → `TRIO_INVALIDE`.
  - `manque multiple` : deux références en manque → `detail` en liste les deux, aucune réservation faite.
  - `rejeu` : confirmer deux fois avec le même `request_id` → résultat identique, réservé compté une fois ; avec un autre `request_id` → `ETAT_INVALIDE`.
  - `concurrence` (`concurrency.test.ts`) : référence à 1 disponible, deux commandes, deux connexions ; A `begin; confirm` sans commit, B lance `confirm` (bloquée), A `commit` → B échoue `STOCK_INSUFFISANT` ; `reserved_qty = 1`, `physical_qty >= reserved_qty`.
  - `même request en parallèle` (`idempotency.test.ts`) : deux connexions, même `request_id` → un seul effet.
  - `site` : `place_site_order` en `service_role` → `channel = 'site'`, statut `confirmee` ; appelée en admin authentifié → erreur de permission ; prix d'entrée ignoré (recalculé).
  - `historique figé` : modifier `offers.price_cents` et le nom après confirmation → `order_lines` inchangées.
  - `customers.test.ts` : `06 12 34 56 78`, `0612345678`, `+212 6 12 34 56 78` → une seule cliente.
- [ ] FAIL → implémenter → PASS (`assertLedger` après chaque test).
- [ ] Commit `feat(db): offers resolution, drafts, atomic confirmation and site orders`.

### Task 5: préparation, expédition, retours, versements

**Fichiers :** `supabase/migrations/0005_fulfilment.sql` ; tests `tests/db/fulfilment.test.ts`, `tests/db/payouts.test.ts`.

**Interfaces produites :**
- `set_item_picked(p_item_id uuid, p_picked boolean) returns void` (commande `confirmee`).
- `mark_prepared(p_request_id uuid, p_order_id uuid) returns jsonb` → toutes les pièces cochées, sinon `VALEUR_INVALIDE`.
- `ship_order(p_request_id uuid, p_order_id uuid, p_carrier text, p_tracking text, p_transport_cost_cents int) returns jsonb` → `{order_id, status:'en_livraison'}` ; une seule mise à jour `physical_qty -= n, reserved_qty -= n` par référence ; `order_items.unit_cost = variants.avg_cost` ; `orders.packaging_cost_cents = settings.packaging_cost_cents` ; ajoute le transporteur à `settings.carriers` s'il est nouveau.
- `cancel_order(p_request_id uuid, p_order_id uuid) returns jsonb` (depuis `confirmee`/`preparee`).
- `mark_delivered(p_request_id uuid, p_order_id uuid) returns jsonb` ; `report_return(p_request_id uuid, p_order_id uuid, p_return_fee_cents int default null) returns jsonb` (depuis `en_livraison`).
- `receive_return(p_request_id uuid, p_order_id uuid, p_items jsonb, p_return_fee_cents int) returns jsonb` ; `p_items = [{item_id, damaged_qty}]` (les autres pièces sont revendables) ; revendables : `physical_qty += q`, coût moyen recalculé avec `unit_cost` figé, mouvement `retour_revendable` ; abîmées : mouvement `retour_perte` (delta 0, `unit_cost` renseigné) ; statut `retour_recu`. Second appel : `ETAT_INVALIDE`.
- `order_expected_cents(p_order_id uuid) returns int` : livrée/payée = bijoux + frais facturés − transport ; retour = −(transport + frais de retour).
- `record_payout(p_request_id uuid, p_carrier text, p_received_on date, p_reference text, p_amount_cents int, p_orders jsonb) returns jsonb` → `{payout_id, expected_cents, received_cents, gap_cents}` ; `p_orders = [{order_id, received_cents?}]` (défaut = attendu) ; livrées → `payee` + `paid_at` ; retours acceptés (`retour_attendu`/`retour_recu`) ; autre statut → `ETAT_INVALIDE` ; déjà rattachée → `COMMANDE_DEJA_RATTACHEE`.

- [ ] Tests (scénario 7 complet, contrôle du stock à chaque étape) : Bronze 10 ; commande de 2 Bronze + 1 Argent confirmée → Bronze phys 10 / rés 2 / disp 8 ; préparée (sans cocher → `VALEUR_INVALIDE`, puis cochée → OK) ; expédiée (transport 3500) → Bronze phys 8 / rés 0 / disp 8 (le disponible ne baisse pas une seconde fois) ; livrée ; versement 2 commandes, montant reçu − 2000 vs attendu → `gap_cents = -2000`, statut `payee` ; 2e versement avec une de ces commandes → `COMMANDE_DEJA_RATTACHEE`.
  - `annulation avant expédition` libère : réservé revient à 0 ; après expédition → `ETAT_INVALIDE`.
  - `retour partiel avec pièce abîmée` : commande 2 Bronze expédiée → retour signalé → `receive_return` avec 1 abîmée, frais 1500 → Bronze phys +1 ; mouvement `retour_perte` qty 1 ; 2e `receive_return` → `ETAT_INVALIDE` et phys inchangé.
  - `coût figé` : expédier à `avg 3000`, puis réassort à 4000 → `order_items.unit_cost` reste 3000.
  - `attendu d'un retour` : transport 3500 + frais 1500 → `order_expected_cents = -5000`.
- [ ] FAIL → implémenter → PASS ; commit `feat(db): preparation, shipping, returns and carrier payouts`.

### Task 6: vues de lecture, recherche, pilotage, import/export

**Fichiers :** `supabase/migrations/0006_views.sql`, `0007_insights.sql`, `0009_storage.sql` ; tests `tests/db/views.test.ts`, `tests/db/dashboard.test.ts`, `tests/db/import.test.ts`.

**Interfaces produites (toutes les vues `with (security_invoker = true)`) :**
- `v_stock` : `variant_id, product_id, product_name, label, sku, photo_path, physical_qty, reserved_qty, available_qty, avg_cost, is_low, archived, offers jsonb [{id,name}]`.
- `v_offers` : `id, name, kind, price_cents, photo_path, on_instagram, on_site, allow_repeat, archived, items jsonb [{variant_id, sku, name, photo_path, qty, price_cents, available_qty}], sellable int` (unité : somme des disponibles ; trio fixe : `min(floor(dispo/qty))` ; trio à composer : nombre de pièces éligibles disponibles), `unit_sum_cents int|null` (trio fixe : somme des prix à l'unité actifs les plus bas, null si une pièce n'en a pas).
- `v_orders` : colonnes de `orders` + `items_total_cents, total_cents, expected_cents, payout_id, payout_reference, received_cents, gap_cents, lines jsonb, items jsonb`.
- `v_payouts` : `id, carrier, received_on, reference, amount_received_cents, expected_cents, gap_cents, order_count`.
- `v_receipts` : historique des arrivages avec lignes.
- `search_all(p_query text) returns jsonb` → `{orders:[], variants:[], payouts:[]}` (max 8 chacun ; numéro, téléphone normalisé, nom, @pseudo, suivi, sku, modèle, référence de versement).
- `dashboard(p_from date, p_to date, p_channel text default null) returns jsonb` →
  `{delivered_count, items_revenue_cents, shipping_billed_cents, avg_basket_cents, cash_received_cents, expected_payouts_cents, returns:{count, rate, fees_cents}, gaps_cents, margin:{items_revenue_cents, shipping_billed_cents, cogs_cents, transport_cents, packaging_cents, return_costs_cents, losses_cents, ad_spend_cents, estimated_cents}, missing:[{code, count}], low_stock:[…]}`. Bases de date : spec §12. Codes `missing` : `packaging_unset`, `ad_spend_missing` (mois de la période sans saisie), `variant_cost_unknown`. Avec `p_channel` renseigné, `ad_spend_cents` est renvoyé mais exclu de `estimated_cents`.
- `shop_catalog` (vue, `grant select to service_role`) : offres `on_site and not archived` avec `items` (sku, nom, photo, `available_qty` plafonné à 10) et `sellable` — c'est la lecture prévue pour la future boutique.
- `export_all() returns jsonb` ; `import_prototype(p_request_id uuid, p_data jsonb) returns jsonb` → `{variants, receipts, offers}` (orders ignorées ; `IMPORT_CONFLIT` si un sku existe).
- `0009_storage.sql` : bucket `photos` public en lecture, écriture admin — enveloppé dans `if exists (select 1 from pg_namespace where nspname = 'storage')`.

- [ ] Tests : `v_offers.sellable` pour un trio fixe {Bronze ×2, Or ×1} avec Bronze 5, Or 4 → 2 ; `unit_sum_cents` ; `search_all('0612345678')` trouve la commande ; `dashboard` sur un jeu connu (2 livrées, 1 retour avec pièce perdue, emballage non réglé) → `missing` contient `packaging_unset` et `ad_spend_missing`, chiffres attendus calculés à la main dans le test ; `import_prototype` d'un JSON au format `{variants:[{sku,model,variant,photo,physical}], offers:[{type,skus,title,price,site,instagram,repeat}], receipts:[{supplier,received,lines:[{sku,qty,cost}]}]}` → comptes exacts, ledger cohérent.
- [ ] FAIL → implémenter → PASS ; commit `feat(db): read views, search, dashboard and import/export`.

### Task 7: bibliothèques front

**Fichiers :** `src/lib/{money,phone,sku,drafts,errors,dates}.ts` ; tests `tests/unit/*.test.ts`.

**Interfaces produites :**
- `parseMoney(input: string): number | null` (centimes) ; `formatMoney(cents: number): string`.
- `normalizePhone(input: string): string | null`.
- `suggestSku(model: string, label: string | null, taken: ReadonlySet<string>): string`.
- `loadDraft<T>(key: string, version: number): T | null` ; `saveDraft<T>(key: string, version: number, value: T): void` ; `clearDraft(key: string): void` (try/catch, clé préfixée `sparkle:`).
- `class AppError extends Error { code: string; details: unknown }` ; `toAppError(e: unknown): AppError` (lit `message`/`details` de PostgREST) ; `messageFor(err: AppError): string` (français, ex. `STOCK_INSUFFISANT` → « Stock insuffisant pour 2 références. », détails rendus par l'UI).
- `formatDate(iso: string): string` → `24 nov. 2026`.

- [ ] Tests : `parseMoney('15,50') === 1550`, `'15.50'` 1550, `'15'` 1500, `' 1 234,5 '` 123450, `'15,5,0'` null, `'-3'` null, `'1,234'` null, `''` null ; `normalizePhone` (trois formes → `+212612345678`, `'12'` null) ; `suggestSku('Bague Luna','Or', new Set())` = `BAGUE-LUNA-OR`, avec `BAGUE-LUNA-OR` pris → `BAGUE-LUNA-OR-2`, sans variante → `BAGUE-LUNA` ; `formatMoney(123450)` contient `1` `234,50` et `MAD` ; drafts : version différente → null.
- [ ] FAIL → implémenter → PASS ; commit `feat(web): money, phone, sku, drafts and error helpers`.

### Task 8: bouchon local, client Supabase, coque et connexion

**Fichiers :** `dev/supabase-stub.ts`, `dev/jwt.ts`, `dev/users.json`, `.env.local-stack`, `src/lib/supabase.ts`, `src/lib/rpc.ts`, `src/lib/useRequest.ts`, `src/app/*`, `src/features/auth/LoginPage.tsx`, `src/styles/*`, `index.html`, `vercel.json` ; tests `tests/e2e/fixtures.ts`, `tests/e2e/shell.spec.ts`.

**Interfaces produites :**
- `supabase` (client unique) ; `callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T>` (lève `AppError`).
- `useRequest<TArgs, TResult>(fn: string): { run(args: TArgs): Promise<TResult>; pending: boolean; error: AppError | null; reset(): void }` — génère un `p_request_id` par envoi, le garde pour les nouvelles tentatives tant que l'envoi n'a pas réussi, ignore un second `run` pendant `pending`.
- Routes : `/connexion, /stock, /stock/arrivage, /stock/:variantId, /offres, /offres/nouvelle, /offres/:id, /commandes, /commandes/nouvelle, /commandes/:id, /preparation, /suivi, /suivi/versements/nouveau, /suivi/versements/:id, /pilotage, /reglages`.
- `<AppLayout>` : barre latérale ≥1024, rail 768–1023, barre inférieure <768 (Stock, Commandes, « + Commande », Suivi, Plus) ; `<ActionBar>` portail pour l'action principale de chaque écran ; lien d'évitement.
- Jetons CSS (`tokens.css`) : valeurs de la spec §8.1 sous `--ivory, --pearl, --ink, --stone, --stone-line, --champagne, --champagne-ink, --ok, --warn, --err, --info, --neutral` (+ fonds `-bg`) ; `glass.css` : classe `.glass` + replis `@supports not (backdrop-filter: blur(1px))`, `@media (prefers-reduced-transparency: reduce)`, `@media (prefers-contrast: more)`.
- Fixture Playwright `loggedInPage` (se connecte avec le compte de `dev/users.json`) ; `resetDb()` (appelle `npm run db:reset` en globalSetup).

- [ ] Écrire `shell.spec.ts` : connexion réussie ; mauvaise connexion → message sous le bouton, e-mail conservé ; navigation des 6 rubriques ; à 390 px la barre inférieure montre Stock, Commandes, Suivi et « + Commande » ; `document.documentElement.scrollWidth <= innerWidth` sur chaque rubrique ; Tab atteint le lien d'évitement puis la navigation avec focus visible (contour calculé non nul) ; avec `reducedMotion: 'reduce'` aucune transition > 0 s.
- [ ] FAIL → implémenter (bouchon : `POST /auth/v1/token?grant_type=password|refresh_token`, `GET /auth/v1/user`, `POST /auth/v1/logout`, `POST /auth/v1/recover`, `POST|PUT /storage/v1/object/photos/*` → `.local/storage`, `GET /storage/v1/object/public/photos/*`, proxy `/rest/v1/*` → `:54331`) → PASS sur les 4 projets Playwright.
- [ ] Vérifier `npm run build` puis `grep -r "supabase-stub\|users.json" dist` → aucun résultat.
- [ ] Commit `feat(web): app shell, glass navigation, login and local Supabase stub`.

### Task 9: composants d'interface

**Fichiers :** `src/ui/*.tsx`, `src/styles/forms.css`, route de dev `/dev/ui` (montée seulement en mode `local-stack`) ; test `tests/e2e/ui-kit.spec.ts`.

**Interfaces produites (props principales) :**
- `Button({variant:'primary'|'secondary'|'ghost'|'danger', pending?, children, ...})` — affiche un indicateur et `aria-busy` quand `pending`, désactivé.
- `Field({label, hint?, error?, children})` ; `MoneyField({label, value: string, onChange, error?})` (`inputMode="decimal"`, suffixe MAD) ; `SelectField`, `Combobox<T>({label, items, getLabel, onSelect, renderItem})`, `Checkbox`, `Switch({label, checked, onChange})`.
- `InlineStatus({state:'idle'|'pending'|'success'|'error', message})` (`role="status"`/`aria-live="polite"`, erreur en `role="alert"`).
- `StatusBadge({status: OrderStatus | 'low' | 'out'})` — libellé + couleur.
- `PhotoSlot({src?: string, size: 40|56|96, selected?, alt})` (écrin rond, repli icône bague).
- `DataList<T>({columns, rows, renderCard, empty, loading, error, onRetry})` — tableau ≥768, cartes <768, squelettes, état vide, erreur + Réessayer.
- `Sheet({title, open, onClose, children})` (panneau latéral / plein écran mobile, focus piégé, Échap), `Dialog` (confirmation), `PageHeader({title, count?, actions?, filters?})`, `Segmented`, `EmptyState`, `Notice({tone, children})`.

- [ ] Écrire `ui-kit.spec.ts` (projet WebKit mode sombre et Chromium) : sur `/dev/ui`, pour chaque `input, select, textarea`, couleur calculée du texte vs fond ≥ 4,5:1, `caret-color` défini (≠ `auto`), placeholder ≥ 4,5:1 ; après remplissage programmatique, texte identique ; un `select` ouvert garde des options lisibles (couleurs calculées des `option`) ; `.glass` absent de tout ancêtre de champ ; `Button pending` → `aria-busy="true"` et désactivé.
- [ ] FAIL → implémenter → PASS ; commit `feat(web): UI kit with explicit form colors and states`.

### Task 10: Stock et Nouvel arrivage

**Fichiers :** `src/features/stock/*`, `src/features/arrivals/*`, `src/lib/photo.ts` ; test `tests/e2e/arrivals.spec.ts`, `tests/unit/photo.test.ts`.

**Interfaces produites :**
- `preparePhoto(file: File): Promise<Blob>` (décodage via `createImageBitmap`, côté le plus long ≤ 1600, JPEG 0,85 ; lève `AppError('PHOTO_ILLISIBLE')`) ; `uploadPhoto(blob: Blob, path: string, onProgress: (ratio: number) => void): Promise<string>` (XHR `POST ${URL}/storage/v1/object/photos/${path}`, `x-upsert: true`) ; `photoUrl(path: string | null): string | null`.
- `arrivalDraft` : clé `arrival`, version 1, `{supplier, receivedOn, lines: ArrivalLine[]}` ; `ArrivalLine = {key, variantId?, sku, productName, label, qty, unitCostCents, photoPath?, photoPreview?}`.
- `StockPage` : `PageHeader` « Stock » + compteur + recherche + filtres (Stock bas, Rupture, Archivées) + action **Nouvel arrivage** ; bandeau d'alerte (références basses + offres concernées) ; `DataList` colonnes photo, modèle, variante, référence, physique, réservé, disponible.
- `VariantSheet` : stock, historique des coûts par arrivage, mouvements, offres, « Changer la photo », « Corriger le stock » (delta + motif).
- `ArrivalPage` : `NewModelForm` (ordre exact des champs de la spec, « Prendre une photo » rendu seulement si `matchMedia('(pointer: coarse)')`), `ExistingModelForm` (Combobox avec photo, modèle, variante, référence), `ArrivalSummary` (fournisseur + date une fois, lignes modifiables/retirables, total, **Valider l'arrivage** dans `ActionBar`).

- [ ] Écrire `arrivals.spec.ts` (scénarios 1–3) :
  - modèle sans variante sans photo → `InlineStatus` « Ligne ajoutée à l'arrivage. » sous le bouton, ligne visible dans le récapitulatif ;
  - modèle avec 2 variantes, l'une avec photo (`tests/e2e/assets/bague.jpg`) → barre de progression visible puis vignette ;
  - fichier `tests/e2e/assets/illisible.jpg` (octets aléatoires) → erreur sous le champ photo, champs conservés ;
  - quantité vide → erreur sous la quantité ;
  - retirer et corriger une ligne avant validation ; valider → stock affiché, historique contient l'arrivage ;
  - réassort d'une référence existante à un autre coût → physique additionné, la fiche montre les deux coûts ;
  - coût `15,50` → récapitulatif `15,50 MAD`, base `1550` (lecture `v_receipts`) ;
  - projet WebKit sombre : texte saisi lisible (contraste calculé) ;
  - reprise après rechargement : lignes et fournisseur retrouvés.
- [ ] `photo.test.ts` (Vitest + jsdom non requis : tester le calcul `fitWithin(w, h, 1600)`).
- [ ] FAIL → implémenter → PASS ; commit `feat(web): stock view and new arrival workspace`.

### Task 11: Offres

**Fichiers :** `src/features/offers/*` ; test `tests/e2e/offers.spec.ts`.

**Interfaces produites :**
- `OffersPage` : liste (nom, format, prix, Instagram et Site en `Switch` libellés « Active »/« En pause », disponibilité `sellable` avec libellé selon le format) + action **Nouvelle offre**.
- `OfferSheet` : nom, format, prix, photo facultative, canaux ; à l'unité : sélection de variantes + « Prix commun »/« Prix par variante » ; trio fixe : `TrioPicker mode="fixed"` + rappel « Même pièces à l'unité : X MAD » et avertissement si prix ≥ `unit_sum_cents` + « N trios réalisables » ; trio à composer : grille d'éligibilité + `Switch` « Autoriser la même pièce plusieurs fois ».
- `TrioPicker({mode:'fixed'|'pick', candidates: OfferItemView[], value: string[], allowRepeat, onChange})` : trois `PhotoSlot` en tête (compteur `0/3`…`3/3`), grille de candidats (photo, nom, disponible ; indisponible visible mais non sélectionnable en mode `pick`).

- [ ] Tests : créer une offre à l'unité à 2 variantes avec prix distincts ; un trio fixe (avertissement quand prix trop haut, disparition quand corrigé) ; un trio à composer ; mettre en pause Instagram → libellé « En pause » ; modifier le prix d'une offre ne change pas une commande confirmée existante (vérifié via `v_orders`).
- [ ] FAIL → implémenter → PASS ; commit `feat(web): offers with unit, fixed trio and pick-your-trio formats`.

### Task 12: Commandes Instagram

**Fichiers :** `src/features/orders/*` ; test `tests/e2e/orders.spec.ts`.

**Interfaces produites :**
- `cartDraft` : clé `cart`, version 1, `{orderId?, lines: CartLine[], customer: CustomerInput, shippingFee: string}` ; `CartLine = {key, offerId, qty, variantId?, picks?: string[]}`.
- `NewOrderPage` : 3 étapes (`Panier`, `Cliente`, `Récapitulatif`) <768 avec `ActionBar` (« Continuer », total), sections empilées ≥768 ; reprise d'un brouillon via `/commandes/nouvelle?brouillon=<id>`.
- `CustomerStep` : téléphone en premier ; à normalisation valide, recherche `customers` + historique (`v_orders` par `customer_id`) → `Notice` « Cliente connue » + bouton « Utiliser ses coordonnées » ; frais de livraison préremplis depuis `settings.default_shipping_fee_cents`.
- `ReviewStep` : composition + pièces, total ; **Enregistrer en brouillon** (`save_order_draft`) et **Confirmer** (`save_order_draft` puis `confirm_order`) ; `STOCK_INSUFFISANT` rendu sous le bouton : une ligne par référence « BRONZE-ROND — besoin 2, disponible 1 » (sans point médian) ; alertes de stock bas affichées après succès avec les offres concernées.
- `OrdersPage` (filtres statut/canal/période, recherche) et `OrderSheet` (chronologie `order_events`, composition, pièces, cliente, versement et écart, actions selon statut).

- [ ] Tests (scénarios 4–5) : trio fixe + unité → la fiche montre Bronze ×2 réservées, Stock affiche disponible 4 et l'alerte avec les offres, offres toujours « Active » ; trio à composer : compteur 0/3→3/3, pièce à 0 non sélectionnable, combinaison devenue indisponible (stock vidé entre-temps par une autre commande) → erreur sous « Confirmer » avec besoin/disponible, panier intact ; brouillon → aucune réservation, liste « Brouillon », reprise → confirmation ; cliente connue préremplie ; panier repris après rechargement ; double clic sur « Confirmer » → une seule réservation.
- [ ] FAIL → implémenter → PASS ; commit `feat(web): Instagram order entry with customer recognition and drafts`.

### Task 13: Préparation, Suivi, retours, versements

**Fichiers :** `src/features/preparation/*`, `src/features/tracking/*` ; test `tests/e2e/fulfilment.spec.ts`.

**Interfaces produites :**
- `PreparationPage` : cartes « À préparer » (composition commerciale, puis pièces regroupées par référence avec `PhotoSlot` et `Checkbox` → `set_item_picked`), **Marquer préparée**, puis formulaire d'expédition (transporteur : `SelectField` des `settings.carriers` + « Autre… », suivi facultatif, `MoneyField` transport) → **Expédier** ; **Annuler la commande** via `Dialog`.
- `TrackingPage` : `Segmented` Livraison en cours / Livrée / Payée / Retour (compteurs) ; Livrée affiche « À recevoir du transporteur : X MAD » (attendu net) ; actions Marquer livrée, Signaler un retour ; `ReturnForm` (pièces pré-comptées revendables, saisie des abîmées, frais de retour) ; action principale **Enregistrer un versement**.
- `PayoutPage` : transporteur, date, référence, montant reçu ; liste à cocher des commandes livrées/retour non rattachées de ce transporteur avec attendu et reçu modifiable ; totaux attendu, reçu, écart en direct ; `PayoutSheet` (commandes du versement, écart).

- [ ] Tests (scénarios 6–7 côté interface) : préparer (bouton actif seulement quand tout est coché ; coche conservée après rechargement), expédier → Stock : physique −, réservé −, disponible inchangé ; livrer ; versement avec écart → fiche commande et versement affichent l'écart ; retour partiel avec une pièce abîmée → seule la revendable revient ; le formulaire de retour disparaît après validation (pas de second passage) ; annulation avant expédition libère ; double clic « Expédier » → une seule expédition ; recherche globale par référence de versement ouvre le versement.
- [ ] FAIL → implémenter → PASS ; commit `feat(web): preparation, shipping, tracking, returns and payouts`.

### Task 14: Pilotage, Réglages, recherche globale, import/export

**Fichiers :** `src/features/dashboard/*`, `src/features/settings/*`, `src/features/search/GlobalSearch.tsx` ; test `tests/e2e/insights.spec.ts`.

**Interfaces produites :**
- `DashboardPage` : filtres période (Ce mois, Mois précédent, 7 jours, Personnalisée) et canal (Tous, Instagram, Site) en paramètres d'URL ; indicateurs en lignes (libellé, valeur tabulaire) ; références en stock bas ; bloc Marge : `Notice` des coûts manquants d'abord, puis le détail « Marge estimée » ; saisie du budget pub par mois.
- `SettingsPage` : seuil, emballage par colis, frais de livraison par défaut, transporteurs (ajout/retrait), « Exporter toutes les données » (`export_all` → fichier `sparkle-export-AAAA-MM-JJ.json`), « Importer un export du prototype » (aperçu des comptes, puis `import_prototype`), déconnexion.
- `GlobalSearch` : `/` ouvre (hors champ de saisie), résultats groupés Commandes / Bijoux / Versements, Entrée ouvre la fiche.

- [ ] Tests : pilotage sur le jeu des tâches précédentes → coûts manquants listés avant la marge ; filtre canal Site → chiffres à 0 et budget pub signalé « non réparti » ; réglage emballage → l'avertissement disparaît ; import d'un fichier prototype de test → comptes affichés puis stock créé ; recherche « / » + numéro `SPK-0001`.
- [ ] FAIL → implémenter → PASS ; commit `feat(web): dashboard, settings, global search and import/export`.

### Task 15: vérification finale, revues, documentation, PR

**Fichiers :** `docs/mise-en-service.md`, `docs/boutique.md`, `README.md` ; corrections issues des revues.

- [ ] `npm run lint && npm run typecheck && npm run test:unit && npm run test:db && npm run test:e2e && npm run build` → tout vert ; noter les chiffres.
- [ ] Revue `web-design-guidelines` (lire `references/command.md`) sur `src/ui/**` et `src/features/**` → corriger, relancer.
- [ ] Revue `vercel-react-best-practices` (règles `client-swr-dedup`, `client-localstorage-schema`, `rerender-*`, `bundle-barrel-imports`) → corriger.
- [ ] Liste de contrôle UI UX Pro Max (`references/pro-rules.md`) + captures à 390/768/1280 relues (mode sombre WebKit compris).
- [ ] Rédiger `docs/mise-en-service.md` (création Supabase, migrations, admin, variables, Vercel) et `docs/boutique.md` (`shop_catalog`, `place_site_order`, idempotence, exemple d'appel serveur).
- [ ] Demander l'accord avant `git push` et `gh pr create` ; ouvrir la PR avec le résumé des vérifications.

---

## Exécution

Méthode : **Native** (superpowers:executing-plans) — la demande impose d'exécuter sans confirmation de routine et de ne pas multiplier les sous-agents ; une revue de branche complète a lieu en Task 15.
