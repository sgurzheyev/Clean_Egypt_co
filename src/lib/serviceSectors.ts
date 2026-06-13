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
  | 'junk_removal';

export type FormTrigger = 'mop' | 'sponge';

export type ServiceOption = { id: ServiceType; labelKey: string };

/** Mop 🧹 — private indoor / home-office services. */
export const PRIVATE_SECTOR_SERVICES: ServiceOption[] = [
  { id: 'home_office', labelKey: 'serviceHomeOffice' },
  { id: 'laundry_ironing', labelKey: 'serviceLaundryIroning' },
  { id: 'windows_facades', labelKey: 'serviceWindowsFacades' },
  { id: 'carpets_mattresses', labelKey: 'serviceCarpetsMattresses' },
  { id: 'kitchen_hoods_grease', labelKey: 'serviceKitchenHoodsGrease' },
  { id: 'ac_cleaning', labelKey: 'serviceAcCleaning' },
  { id: 'pest_control', labelKey: 'servicePestControl' },
];

/** Sponge 🧽 — street, vehicle, and outdoor object services. */
export const STREET_OBJECT_SECTOR_SERVICES: ServiceOption[] = [
  { id: 'car_detailing', labelKey: 'serviceCarDetailing' },
  { id: 'yacht_boat_cleaning', labelKey: 'serviceYachtBoatCleaning' },
  { id: 'junk_removal', labelKey: 'serviceJunkRemoval' },
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

export function findServiceOption(id: string | null | undefined): ServiceOption | undefined {
  return ALL_SECTOR_SERVICES.find((s) => s.id === id);
}
