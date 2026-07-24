/** Supabase `missions.service_type` string ids — do not rename (existing rows). */
export type ServiceType =
  | 'home_office'
  | 'ac_cleaning'
  | 'pool_maintenance'
  | 'pest_control'
  | 'windows_facades'
  | 'terrace_garden'
  | 'car_detailing'
  | 'yacht_boat_cleaning'
  | 'solar_panels'
  | 'ultrasound_cleaning'
  | 'carpets_mattresses'
  | 'kitchen_hoods_grease'
  | 'laundry_ironing'
  | 'water_tank_cleaning'
  | 'junk_removal'
  | 'beach_street_cleanup';

export type FormTrigger = 'mop' | 'sponge';

export type ServiceOption = { id: ServiceType; labelKey: string };

/** Sponge 🧽 — private indoor / home-office services (ОЧИСТИТЬ ДОМ/ОФИС). */
export const PRIVATE_SECTOR_SERVICES: ServiceOption[] = [
  { id: 'home_office', labelKey: 'serviceHomeOffice' },
  { id: 'laundry_ironing', labelKey: 'serviceLaundryIroning' },
  { id: 'windows_facades', labelKey: 'serviceWindowsFacades' },
  { id: 'carpets_mattresses', labelKey: 'serviceCarpetsMattresses' },
  { id: 'kitchen_hoods_grease', labelKey: 'serviceKitchenHoodsGrease' },
  { id: 'ac_cleaning', labelKey: 'serviceAcCleaning' },
  { id: 'pest_control', labelKey: 'servicePestControl' },
];

/** Mop 🧹 — street, city, beach, and outdoor object services (ОЧИСТИТЬ ОБЪЕКТ/УЛИЦУ). */
export const STREET_OBJECT_SECTOR_SERVICES: ServiceOption[] = [
  { id: 'car_detailing', labelKey: 'serviceCarDetailing' },
  { id: 'yacht_boat_cleaning', labelKey: 'serviceYachtBoatCleaning' },
  { id: 'junk_removal', labelKey: 'serviceJunkRemoval' },
  { id: 'beach_street_cleanup', labelKey: 'serviceBeachStreetCleanup' },
  { id: 'terrace_garden', labelKey: 'serviceTerraceGarden' },
  { id: 'pool_maintenance', labelKey: 'servicePoolMaintenance' },
  { id: 'solar_panels', labelKey: 'serviceSolarPanels' },
  { id: 'water_tank_cleaning', labelKey: 'serviceWaterTankCleaning' },
  { id: 'ultrasound_cleaning', labelKey: 'serviceUltrasoundCleaning' },
];

export const ALL_SECTOR_SERVICES: ServiceOption[] = [
  ...PRIVATE_SECTOR_SERVICES,
  ...STREET_OBJECT_SECTOR_SERVICES,
];

export function servicesForTrigger(trigger: FormTrigger): ServiceOption[] {
  return trigger === 'sponge' ? PRIVATE_SECTOR_SERVICES : STREET_OBJECT_SECTOR_SERVICES;
}

export function defaultServiceForTrigger(trigger: FormTrigger): ServiceType {
  return servicesForTrigger(trigger)[0]?.id ?? 'home_office';
}

export function taskTypeForTrigger(trigger: FormTrigger): 'home' | 'city' {
  return trigger === 'sponge' ? 'home' : 'city';
}

const PRIVATE_SERVICE_ID_SET = new Set<string>(PRIVATE_SECTOR_SERVICES.map((s) => s.id));

/**
 * Sector of a persisted mission. `service_type` is authoritative (it records which
 * form created the mission); `category` is a legacy fallback because older RPCs
 * stored 'public' for every mission regardless of sector.
 */
export function missionSector(
  serviceType: string | null | undefined,
  category?: string | null
): 'home' | 'city' {
  if (serviceType) {
    return PRIVATE_SERVICE_ID_SET.has(serviceType) ? 'home' : 'city';
  }
  const c = String(category ?? '').toLowerCase();
  return c === 'home' || c === 'office' ? 'home' : 'city';
}

/** Map pin + list icon: sponge = home/office, mop = street/city/beach, warning = report. */
export function missionPinIcon(
  serviceType: string | null | undefined,
  category?: string | null,
  isReport?: boolean | null
): string {
  if (isReport) return '⚠️';
  return missionSector(serviceType, category) === 'home' ? '🧽' : '🧹';
}

/** Mapbox image ids for emoji pin icons (registered via canvas at map load). */
export const PIN_ICON_IMAGE_SPONGE = 'pin-icon-sponge';
export const PIN_ICON_IMAGE_MOP = 'pin-icon-mop';
export const PIN_ICON_IMAGE_REPORT = 'pin-icon-report';

export function missionPinIconImage(
  serviceType: string | null | undefined,
  category?: string | null,
  isReport?: boolean | null
): string {
  if (isReport) return PIN_ICON_IMAGE_REPORT;
  return missionSector(serviceType, category) === 'home'
    ? PIN_ICON_IMAGE_SPONGE
    : PIN_ICON_IMAGE_MOP;
}

export function findServiceOption(id: string | null | undefined): ServiceOption | undefined {
  return ALL_SECTOR_SERVICES.find((s) => s.id === id);
}
