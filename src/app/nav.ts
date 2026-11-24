import type { ComponentType, SVGProps } from 'react';
import {
  IconDashboard,
  IconOffers,
  IconOrders,
  IconPreparation,
  IconSettings,
  IconStock,
  IconTracking,
} from '../ui/icons';

export interface NavItem {
  label: string;
  to: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  /** Shown directly in the phone bottom bar; the others go in the "Plus" menu. */
  phone: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Stock', to: '/stock', icon: IconStock, phone: true },
  { label: 'Offres', to: '/offres', icon: IconOffers, phone: false },
  { label: 'Commandes', to: '/commandes', icon: IconOrders, phone: true },
  { label: 'Préparation', to: '/preparation', icon: IconPreparation, phone: false },
  { label: 'Suivi', to: '/suivi', icon: IconTracking, phone: true },
  { label: 'Pilotage', to: '/pilotage', icon: IconDashboard, phone: false },
];

export const SETTINGS_ITEM: NavItem = { label: 'Réglages', to: '/reglages', icon: IconSettings, phone: false };

export const NEW_ORDER_PATH = '/commandes/nouvelle';
