/**
 * Contractor "My Store" — 3-step onboarding wizard (Identity → Zone → Publish)
 * plus optional Advanced tools (Inventory / Bundles / Recurring).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import imageCompression from 'browser-image-compression';
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Package,
  Plus,
  RefreshCw,
  Sparkles,
  Store,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PROFILE_GLASS_PANEL } from '../constants';
import {
  ALL_SECTOR_SERVICES,
  findServiceOption,
  type ServiceType,
} from '../src/lib/serviceSectors';
import {
  EMPTY_STORE_DRAFT,
  EMPTY_SUPPLY_DRAFT,
  RECURRENCE_TYPES,
  STORE_BUNDLES_MAX,
  STORE_MATERIALS_MAX,
  STORE_PHOTOS_MAX,
  STORE_SERVICE_UNITS,
  STORE_SUPPLIES_MAX,
  SUPPLY_CATEGORIES,
  createEmptyBundle,
  deleteContractorStore,
  deleteStoreSupply,
  fetchContractorStore,
  fetchStoreSupplies,
  insertStoreSupply,
  polygonFromRadiusKm,
  skuIds,
  storeToDraft,
  toggleStoreServiceInDraft,
  updateStoreServiceSkuInDraft,
  uploadStorePhoto,
  uploadSupplyPhoto,
  upsertContractorStore,
  type ContractorStoreDraft,
  type RecurrenceType,
  type ServiceBundle,
  type StoreServiceUnit,
  type StoreSupply,
  type StoreSupplyDraft,
  type SupplyCategory,
} from '../src/lib/contractorStore';
import {
  OFFLINE_UPLOAD_FLUSHED_EVENT,
  ensureOfflineUploadListeners,
  enqueueOfflineUpload,
  flushOfflineUploadQueue,
  isUploadNetworkFailure,
  type OfflineUploadFlushedDetail,
} from '../src/lib/offlineUploadQueue';
import { recurrenceLabelKey } from './StoreShowcaseSections';
import {
  DEFAULT_STORE_COLOR,
  normalizeStoreColor,
  STORE_NEON_PALETTE,
} from '../src/lib/mapboxStandardTheme';
import StoreCoverageMap from './StoreCoverageMap';

export type ContractorStorePanelProps = {
  userId: string;
  /** Compact embed inside a Profile accordion. */
  embedded?: boolean;
  /** Fired when a store row is created or permanently removed. */
  onStorePresenceChange?: (hasStore: boolean) => void;
};

type WizardStep = 1 | 2 | 3;
type AdvancedTab = 'inventory' | 'bundles' | 'recurring' | null;

const COVERAGE_RADIUS_KM = 5;

const ContractorStorePanel: React.FC<ContractorStorePanelProps> = ({
  userId,
  embedded = true,
  onStorePresenceChange,
}) => {
  const { t } = useTranslation();
  const [step, setStep] = useState<WizardStep>(1);
  const [advancedTab, setAdvancedTab] = useState<AdvancedTab>(null);
  const [draft, setDraft] = useState<ContractorStoreDraft>({ ...EMPTY_STORE_DRAFT });
  const [storeId, setStoreId] = useState<string | null>(null);
  const [supplies, setSupplies] = useState<StoreSupply[]>([]);
  const [supplyDraft, setSupplyDraft] = useState<StoreSupplyDraft>({
    ...EMPTY_SUPPLY_DRAFT,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [materialInput, setMaterialInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorIsSoft, setErrorIsSoft] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const showHardError = (message: string) => {
    setErrorIsSoft(false);
    setError(message);
  };

  const showSoftNetworkNotice = () => {
    setErrorIsSoft(true);
    setError(
      t('weakConnectionQueuedUpload', {
        defaultValue:
          'Weak connection. Saving data — it will send automatically when the network is back.',
      })
    );
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorIsSoft(false);
    try {
      const store = await fetchContractorStore(userId);
      setDraft(storeToDraft(store));
      setStoreId(store?.id ?? null);
      if (store?.id) {
        setSupplies(await fetchStoreSupplies(store.id));
      } else {
        setSupplies([]);
      }
    } catch (err) {
      console.error('fetchContractorStore failed', err);
      if (isUploadNetworkFailure(err)) {
        showSoftNetworkNotice();
      } else {
        showHardError(
          t('storeLoadFailed', {
            defaultValue: 'Could not load your store. Try again.',
          })
        );
      }
    } finally {
      setLoading(false);
    }
  }, [t, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    ensureOfflineUploadListeners();
    void flushOfflineUploadQueue(userId);
  }, [userId]);

  useEffect(() => {
    const onFlushed = (ev: Event) => {
      const detail = (ev as CustomEvent<OfflineUploadFlushedDetail>).detail;
      if (!detail || detail.userId !== userId) return;
      if (detail.kind === 'store_photo') {
        setDraft((prev) => ({
          ...prev,
          store_photos: [...prev.store_photos, detail.url].slice(0, STORE_PHOTOS_MAX),
        }));
      } else if (detail.kind === 'supply_photo') {
        setSupplyDraft((prev) =>
          prev.image_url ? prev : { ...prev, image_url: detail.url }
        );
      }
      setSuccess(
        t('storeSavedDraft', {
          defaultValue: 'Store draft saved.',
        })
      );
      setError(null);
      setErrorIsSoft(false);
    };
    window.addEventListener(OFFLINE_UPLOAD_FLUSHED_EVENT, onFlushed);
    return () => window.removeEventListener(OFFLINE_UPLOAD_FLUSHED_EVENT, onFlushed);
  }, [t, userId]);

  const toggleService = (id: ServiceType) => {
    setDraft((prev) => {
      const store_service_skus = toggleStoreServiceInDraft(
        prev.store_service_skus,
        id
      );
      return {
        ...prev,
        store_service_skus,
        offered_services: skuIds(store_service_skus),
      };
    });
  };

  const patchServiceSku = (
    serviceId: string,
    patch: Partial<{ base_price: number; unit: StoreServiceUnit }>
  ) => {
    setDraft((prev) => {
      const store_service_skus = updateStoreServiceSkuInDraft(
        prev.store_service_skus,
        serviceId,
        patch
      );
      return {
        ...prev,
        store_service_skus,
        offered_services: skuIds(store_service_skus),
      };
    });
  };

  const addMaterial = () => {
    const value = materialInput.trim();
    if (!value) return;
    setDraft((prev) => {
      if (prev.materials_and_chemicals.length >= STORE_MATERIALS_MAX) return prev;
      if (
        prev.materials_and_chemicals.some(
          (m) => m.toLowerCase() === value.toLowerCase()
        )
      ) {
        return prev;
      }
      return {
        ...prev,
        materials_and_chemicals: [...prev.materials_and_chemicals, value],
      };
    });
    setMaterialInput('');
  };

  const removeMaterial = (item: string) => {
    setDraft((prev) => ({
      ...prev,
      materials_and_chemicals: prev.materials_and_chemicals.filter((m) => m !== item),
    }));
  };

  const onPhotosSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((f) =>
      f.type.startsWith('image/')
    );
    e.target.value = '';
    if (files.length === 0) return;
    const remaining = STORE_PHOTOS_MAX - draft.store_photos.length;
    if (remaining <= 0) {
      setError(
        t('storePhotosCap', {
          defaultValue: 'Maximum {{count}} store photos.',
          count: STORE_PHOTOS_MAX,
        })
      );
      return;
    }
    setUploading(true);
    setError(null);
    setErrorIsSoft(false);
    try {
      const urls: string[] = [];
      for (const file of files.slice(0, remaining)) {
        const compressed = (await imageCompression(file, {
          maxSizeMB: 0.7,
          maxWidthOrHeight: 1600,
          useWebWorker: true,
          fileType: 'image/jpeg',
        })) as File;
        try {
          urls.push(await uploadStorePhoto(userId, compressed));
        } catch (uploadErr) {
          if (isUploadNetworkFailure(uploadErr)) {
            await enqueueOfflineUpload({
              userId,
              kind: 'store_photo',
              file: compressed,
              fileName: compressed.name || file.name,
            });
            showSoftNetworkNotice();
            continue;
          }
          throw uploadErr;
        }
      }
      if (urls.length > 0) {
        setDraft((prev) => ({
          ...prev,
          store_photos: [...prev.store_photos, ...urls].slice(0, STORE_PHOTOS_MAX),
        }));
      }
    } catch (err) {
      console.error('store photo upload failed', err);
      if (isUploadNetworkFailure(err)) {
        showSoftNetworkNotice();
      } else {
        showHardError(
          t('storePhotoUploadFailed', {
            defaultValue: 'Photo upload failed. Please try again.',
          })
        );
      }
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (url: string) => {
    setDraft((prev) => ({
      ...prev,
      store_photos: prev.store_photos.filter((u) => u !== url),
    }));
  };

  const ensureStoreId = async (): Promise<string> => {
    if (storeId) return storeId;
    const saved = await upsertContractorStore(userId, {
      ...draft,
      is_published: draft.is_published,
    });
    setStoreId(saved.id);
    setDraft(storeToDraft(saved));
    return saved.id;
  };

  const onSupplyPhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = (e.target.files || [])[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    setUploading(true);
    setError(null);
    setErrorIsSoft(false);
    try {
      const compressed = (await imageCompression(file, {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 1200,
        useWebWorker: true,
        fileType: 'image/jpeg',
      })) as File;
      try {
        const url = await uploadSupplyPhoto(userId, compressed);
        setSupplyDraft((prev) => ({ ...prev, image_url: url }));
      } catch (uploadErr) {
        if (isUploadNetworkFailure(uploadErr)) {
          await enqueueOfflineUpload({
            userId,
            kind: 'supply_photo',
            file: compressed,
            fileName: compressed.name || file.name,
          });
          showSoftNetworkNotice();
          return;
        }
        throw uploadErr;
      }
    } catch (err) {
      console.error('supply photo upload failed', err);
      if (isUploadNetworkFailure(err)) {
        showSoftNetworkNotice();
      } else {
        showHardError(
          t('storePhotoUploadFailed', {
            defaultValue: 'Photo upload failed. Please try again.',
          })
        );
      }
    } finally {
      setUploading(false);
    }
  };

  const handleAddSupply = async () => {
    const name = supplyDraft.name.trim();
    if (!name) {
      setError(
        t('storeSupplyNameRequired', {
          defaultValue: 'Enter a supply name.',
        })
      );
      return;
    }
    if (supplies.length >= STORE_SUPPLIES_MAX) {
      setError(
        t('storeSuppliesCap', {
          defaultValue: 'Maximum {{count}} supply items.',
          count: STORE_SUPPLIES_MAX,
        })
      );
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const sid = await ensureStoreId();
      const row = await insertStoreSupply(sid, supplyDraft, supplies.length);
      setSupplies((prev) => [...prev, row]);
      setSupplyDraft({ ...EMPTY_SUPPLY_DRAFT });
      setSuccess(
        t('storeSupplyAdded', { defaultValue: 'Supply item added.' })
      );
    } catch (err) {
      console.error('insertStoreSupply failed', err);
      setError(
        t('storeSaveFailed', {
          defaultValue: 'Could not save store. Check permissions and try again.',
        })
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveSupply = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      await deleteStoreSupply(id);
      setSupplies((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error('deleteStoreSupply failed', err);
      setError(
        t('storeSaveFailed', {
          defaultValue: 'Could not save store. Check permissions and try again.',
        })
      );
    } finally {
      setSaving(false);
    }
  };

  const updateBundle = (id: string, patch: Partial<ServiceBundle>) => {
    setDraft((prev) => ({
      ...prev,
      service_bundles: prev.service_bundles.map((b) =>
        b.id === id ? { ...b, ...patch } : b
      ),
    }));
  };

  const addBundle = () => {
    setDraft((prev) => {
      if (prev.service_bundles.length >= STORE_BUNDLES_MAX) return prev;
      return {
        ...prev,
        service_bundles: [...prev.service_bundles, createEmptyBundle()],
      };
    });
  };

  const removeBundle = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      service_bundles: prev.service_bundles.filter((b) => b.id !== id),
    }));
  };

  const toggleBundleService = (bundleId: string, serviceId: string) => {
    setDraft((prev) => ({
      ...prev,
      service_bundles: prev.service_bundles.map((b) => {
        if (b.id !== bundleId) return b;
        const exists = b.service_ids.includes(serviceId);
        const service_ids = exists
          ? b.service_ids.filter((s) => s !== serviceId)
          : b.service_ids.length >= 3
            ? b.service_ids
            : [...b.service_ids, serviceId];
        return { ...b, service_ids };
      }),
    }));
  };

  const toggleRecurrence = (type: RecurrenceType) => {
    setDraft((prev) => {
      const has = prev.supported_recurrence_types.includes(type);
      let next: RecurrenceType[];
      if (type === 'one_time') {
        // Always keep at least one_time when clearing recurring options.
        next = has && prev.supported_recurrence_types.length === 1
          ? ['one_time']
          : has
            ? prev.supported_recurrence_types.filter((r) => r !== 'one_time')
            : [...prev.supported_recurrence_types, 'one_time'];
        if (next.length === 0) next = ['one_time'];
      } else if (has) {
        next = prev.supported_recurrence_types.filter((r) => r !== type);
        if (next.length === 0) next = ['one_time'];
      } else {
        next = [...prev.supported_recurrence_types, type];
        if (!next.includes('one_time')) next = ['one_time', ...next];
      }
      const primary =
        next.find((r) => r !== 'one_time') ??
        (next.includes(prev.recurrence_type) ? prev.recurrence_type : 'one_time');
      return {
        ...prev,
        supported_recurrence_types: next,
        recurrence_type: primary,
      };
    });
  };

  const acceptsRecurring = draft.supported_recurrence_types.some(
    (r) => r !== 'one_time'
  );

  const setAcceptsRecurring = (on: boolean) => {
    setDraft((prev) => {
      if (on) {
        const next = prev.supported_recurrence_types.some((r) => r !== 'one_time')
          ? prev.supported_recurrence_types
          : (['one_time', 'weekly', 'monthly'] as RecurrenceType[]);
        return {
          ...prev,
          supported_recurrence_types: next,
          recurrence_type: next.find((r) => r !== 'one_time') ?? 'weekly',
        };
      }
      return {
        ...prev,
        supported_recurrence_types: ['one_time'],
        recurrence_type: 'one_time',
      };
    });
  };

  const handleSave = async (publish?: boolean) => {
    if (publish === true) {
      const okName = draft.store_name.trim().length > 0;
      const okOffice =
        typeof draft.office_lat === 'number' &&
        typeof draft.office_lng === 'number' &&
        Number.isFinite(draft.office_lat) &&
        Number.isFinite(draft.office_lng);
      const okSku = draft.store_service_skus.some((s) => s.base_price > 0);
      if (!okName || !okOffice || !okSku) {
        setStep(3);
        setError(
          t('storePublishBlocked', {
            defaultValue:
              'Finish the checklist before publishing (name, office pin, priced service).',
          })
        );
        return;
      }
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const next = {
        ...draft,
        is_published: typeof publish === 'boolean' ? publish : draft.is_published,
        service_bundles: draft.service_bundles.filter((b) => b.title.trim()),
      };
      const saved = await upsertContractorStore(userId, next);
      setDraft(storeToDraft(saved));
      setStoreId(saved.id);
      onStorePresenceChange?.(true);
      setSuccess(
        next.is_published
          ? t('storeSavedPublished', {
              defaultValue: 'Store saved and published.',
            })
          : t('storeSavedDraft', { defaultValue: 'Store draft saved.' })
      );
    } catch (err) {
      console.error('upsertContractorStore failed', err);
      if (isUploadNetworkFailure(err)) {
        showSoftNetworkNotice();
      } else {
        showHardError(
          t('storeSaveFailed', {
            defaultValue: 'Could not save store. Check permissions and try again.',
          })
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUnpublish = async () => {
    if (!draft.is_published || saving || uploading) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const next = {
        ...draft,
        is_published: false,
        service_bundles: draft.service_bundles.filter((b) => b.title.trim()),
      };
      const saved = await upsertContractorStore(userId, next);
      setDraft(storeToDraft(saved));
      setStoreId(saved.id);
      setSuccess(
        t('storeUnpublishedSuccess', {
          defaultValue: 'Store unpublished — hidden from public maps.',
        })
      );
    } catch (err) {
      console.error('unpublish store failed', err);
      setError(
        t('storeUnpublishFailed', {
          defaultValue: 'Could not unpublish store. Try again.',
        })
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStore = async () => {
    if (!storeId || saving || uploading) return;
    const confirmed = window.confirm(
      t('storeDeleteConfirm', {
        defaultValue:
          'Are you sure? This will permanently delete your storefront, supplies, and coverage zone.',
      })
    );
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await deleteContractorStore(userId);
      setDraft({
        ...EMPTY_STORE_DRAFT,
        service_bundles: [],
        store_service_skus: [],
      });
      setStoreId(null);
      setSupplies([]);
      setSupplyDraft({ ...EMPTY_SUPPLY_DRAFT });
      setMaterialInput('');
      setStep(1);
      setAdvancedTab(null);
      onStorePresenceChange?.(false);
      setSuccess(
        t('storeDeletedSuccess', {
          defaultValue: 'Store permanently deleted.',
        })
      );
    } catch (err) {
      console.error('deleteContractorStore failed', err);
      setError(
        t('storeDeleteFailed', {
          defaultValue: 'Could not delete store. Check permissions and try again.',
        })
      );
    } finally {
      setSaving(false);
    }
  };

  const applyFiveKmRadius = () => {
    const lat = draft.office_lat;
    const lng = draft.office_lng;
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      setError(
        t('storeRadiusNeedOffice', {
          defaultValue: 'Pin your office first, then apply a 5 km radius.',
        })
      );
      return;
    }
    const poly = polygonFromRadiusKm(lat, lng, COVERAGE_RADIUS_KM);
    if (!poly) return;
    setDraft((p) => ({ ...p, service_radius_polygon: poly }));
    setError(null);
    setSuccess(
      t('storeRadiusApplied', {
        defaultValue: '5 km coverage circle applied around your office.',
      })
    );
  };

  const publishChecklist = useMemo(() => {
    const hasName = draft.store_name.trim().length > 0;
    const hasOffice =
      typeof draft.office_lat === 'number' &&
      typeof draft.office_lng === 'number' &&
      Number.isFinite(draft.office_lat) &&
      Number.isFinite(draft.office_lng);
    const hasPricedSku = draft.store_service_skus.some((s) => s.base_price > 0);
    return {
      hasName,
      hasOffice,
      hasPricedSku,
      canPublish: hasName && hasOffice && hasPricedSku,
    };
  }, [draft.store_name, draft.office_lat, draft.office_lng, draft.store_service_skus]);

  if (loading) {
    return <p className="text-sm italic text-slate-500">{t('loading')}</p>;
  }

  const wizardSteps: { id: WizardStep; label: string }[] = [
    {
      id: 1,
      label: t('storeWizardStepIdentity', {
        defaultValue: 'Identity & Services',
      }),
    },
    {
      id: 2,
      label: t('storeWizardStepCoverage', { defaultValue: 'Coverage Zone' }),
    },
    {
      id: 3,
      label: t('storeWizardStepPublish', { defaultValue: 'Publish' }),
    },
  ];

  const checklistItems = [
    {
      key: 'name',
      ok: publishChecklist.hasName,
      label: t('storeCheckName', {
        defaultValue: 'Store name filled in',
      }),
      go: () => setStep(1) as void,
    },
    {
      key: 'office',
      ok: publishChecklist.hasOffice,
      label: t('storeCheckOffice', {
        defaultValue: 'Office pin placed on the map',
      }),
      go: () => setStep(2) as void,
    },
    {
      key: 'sku',
      ok: publishChecklist.hasPricedSku,
      label: t('storeCheckSku', {
        defaultValue: 'At least one service with a floor price',
      }),
      go: () => setStep(1) as void,
    },
  ];

  return (
    <div className={`space-y-4 ${embedded ? '' : 'p-4'}`}>
      {!embedded && (
        <div className="flex items-center gap-2">
          <Store className="h-5 w-5 text-emerald-400" />
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">
            {t('myStore', { defaultValue: 'My Store' })}
          </h2>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-slate-400">
        {t('storeWizardHint', {
          defaultValue:
            'Three steps to go live: identity & prices → coverage → publish checklist.',
        })}
      </p>

      {/* Wizard step indicator */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          {wizardSteps.map((item, idx) => {
            const active = step === item.id;
            const done = step > item.id;
            return (
              <React.Fragment key={item.id}>
                {idx > 0 && (
                  <div
                    className={`h-px flex-1 ${
                      done ? 'bg-emerald-400/50' : 'bg-white/10'
                    }`}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setStep(item.id)}
                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-black transition-colors ${
                    active
                      ? 'border-emerald-400/60 bg-emerald-500/30 text-emerald-50'
                      : done
                        ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                        : 'border-white/15 bg-white/5 text-slate-400'
                  }`}
                  aria-current={active ? 'step' : undefined}
                  aria-label={item.label}
                >
                  {done && !active ? (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    item.id
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300/90">
          {wizardSteps.find((s) => s.id === step)?.label}
        </p>
      </div>

      {/* ─── Step 1: Identity & Services ─── */}
      {step === 1 && (
        <div className="space-y-5">
          <section className="space-y-2">
            <label className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              {t('storeNameLabel', { defaultValue: 'Store name' })}
            </label>
            <input
              type="text"
              value={draft.store_name}
              onChange={(e) =>
                setDraft((p) => ({ ...p, store_name: e.target.value }))
              }
              maxLength={80}
              placeholder={t('storeNamePlaceholder', {
                defaultValue: 'e.g. Neon Clean Co.',
              })}
              className={`w-full ${PROFILE_GLASS_PANEL} bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400/50`}
            />
            <label className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              {t('storeBioLabel', { defaultValue: 'About the store' })}
            </label>
            <textarea
              value={draft.store_bio}
              onChange={(e) =>
                setDraft((p) => ({ ...p, store_bio: e.target.value }))
              }
              maxLength={600}
              rows={3}
              placeholder={t('storeBioPlaceholder', {
                defaultValue: 'Team, hygiene standards, response time…',
              })}
              className={`w-full resize-none ${PROFILE_GLASS_PANEL} bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400/50`}
            />
          </section>

          <section className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              {t('storeHeroPhoto', {
                defaultValue: 'Main / cover photo',
              })}
            </p>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-cyan-400/40 bg-cyan-500/5 px-4 py-6 text-center transition-colors hover:bg-cyan-500/10">
              <Camera className="h-6 w-6 text-cyan-300" />
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100">
                {uploading
                  ? t('processing')
                  : t('storeUploadPhotos', { defaultValue: 'Upload photos' })}
              </span>
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={uploading || draft.store_photos.length >= STORE_PHOTOS_MAX}
                onChange={(e) => void onPhotosSelected(e)}
                className="hidden"
              />
            </label>
            {draft.store_photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {draft.store_photos.map((url, idx) => (
                  <div
                    key={url}
                    className="relative overflow-hidden rounded-lg border border-white/10 bg-slate-900"
                  >
                    <img src={url} alt="" className="h-24 w-full object-cover" />
                    {idx === 0 && (
                      <span className="absolute left-1 top-1 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-white">
                        {t('storeCoverBadge', { defaultValue: 'Cover' })}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removePhoto(url)}
                      className="absolute right-1 top-1 rounded-full border border-red-400/50 bg-black/70 p-1 text-red-200"
                      aria-label={t('remove', { defaultValue: 'Remove' })}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              {t('storeServicesSection', { defaultValue: 'Services offered' })}
            </p>
            <p className="text-[11px] leading-relaxed text-slate-400">
              {t('storeServicesSkuHint', {
                defaultValue:
                  'Toggle services, then set a floor price and unit for each. Customers see “From $X”.',
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              {ALL_SECTOR_SERVICES.map((svc) => {
                const active = draft.store_service_skus.some((s) => s.id === svc.id);
                return (
                  <button
                    key={svc.id}
                    type="button"
                    onClick={() => toggleService(svc.id)}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] transition-colors ${
                      active
                        ? 'border-emerald-400/55 bg-emerald-500/25 text-emerald-100'
                        : 'border-white/12 bg-white/5 text-slate-400 hover:border-white/25'
                    }`}
                  >
                    {t(svc.labelKey)}
                  </button>
                );
              })}
            </div>

            {draft.store_service_skus.length > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-400/80">
                  {t('storeSkuPricingTitle', {
                    defaultValue: 'Floor prices',
                  })}
                </p>
                {draft.store_service_skus.map((sku) => {
                  const opt = findServiceOption(sku.id);
                  return (
                    <div
                      key={sku.id}
                      className={`space-y-2 rounded-xl border border-emerald-400/25 bg-emerald-500/5 p-3 ${PROFILE_GLASS_PANEL}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-emerald-50">
                          {opt ? t(opt.labelKey) : sku.name || sku.id}
                        </p>
                        <button
                          type="button"
                          onClick={() => toggleService(sku.id as ServiceType)}
                          className="rounded-full border border-white/15 bg-black/30 p-1 text-slate-300 hover:text-white"
                          aria-label={t('remove', { defaultValue: 'Remove' })}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1">
                          <span className="block text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">
                            {t('storeSkuFloorPrice', {
                              defaultValue: 'Floor price (USD)',
                            })}
                          </span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            value={sku.base_price || ''}
                            onChange={(e) =>
                              patchServiceSku(sku.id, {
                                base_price: Math.max(
                                  0,
                                  Math.floor(Number(e.target.value) || 0)
                                ),
                              })
                            }
                            placeholder="0"
                            className={`w-full ${PROFILE_GLASS_PANEL} bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/50`}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="block text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">
                            {t('storeSkuUnit', {
                              defaultValue: 'Unit',
                            })}
                          </span>
                          <select
                            value={sku.unit}
                            onChange={(e) =>
                              patchServiceSku(sku.id, {
                                unit: e.target.value as StoreServiceUnit,
                              })
                            }
                            className={`w-full ${PROFILE_GLASS_PANEL} bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/50`}
                          >
                            {STORE_SERVICE_UNITS.map((unit) => (
                              <option key={unit} value={unit} className="bg-slate-900">
                                {t(`storeSkuUnit_${unit}`, {
                                  defaultValue:
                                    unit === 'job'
                                      ? 'Per job'
                                      : unit === 'hour'
                                        ? 'Per hour'
                                        : 'Per m²',
                                })}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ─── Step 2: Coverage Zone ─── */}
      {step === 2 && (
        <div className="space-y-4">
          <section className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              {t('storeCoverageSection', {
                defaultValue: 'Office & coverage zone',
              })}
            </p>
            <p className="text-[11px] leading-relaxed text-slate-400">
              {t('storeCoverageWizardHint', {
                defaultValue:
                  'Pin your office, then draw a zone — or tap 5 km radius for a quick circle.',
              })}
            </p>

            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                {t('storeZoneColor', { defaultValue: 'Zone color' })}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {STORE_NEON_PALETTE.map((swatch) => {
                  const active =
                    normalizeStoreColor(draft.color) ===
                    normalizeStoreColor(swatch.hex);
                  return (
                    <button
                      key={swatch.id}
                      type="button"
                      title={t(swatch.labelKey, { defaultValue: swatch.hex })}
                      aria-label={t(swatch.labelKey, { defaultValue: swatch.hex })}
                      aria-pressed={active}
                      onClick={() =>
                        setDraft((p) => ({
                          ...p,
                          color: normalizeStoreColor(swatch.hex),
                        }))
                      }
                      className={`h-8 w-8 rounded-full border-2 transition-transform active:scale-95 ${
                        active
                          ? 'scale-110 border-white shadow-[0_0_14px_currentColor]'
                          : 'border-white/25 hover:border-white/60'
                      }`}
                      style={{
                        backgroundColor: swatch.hex,
                        color: swatch.hex,
                        boxShadow: active
                          ? `0 0 14px ${swatch.hex}, 0 0 28px ${swatch.hex}66`
                          : undefined,
                      }}
                    />
                  );
                })}
                <label className="relative inline-flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-white/35 bg-black/40 text-[9px] font-black uppercase tracking-wider text-slate-400 hover:border-cyan-400/50">
                  <span aria-hidden>+</span>
                  <input
                    type="color"
                    value={normalizeStoreColor(draft.color || DEFAULT_STORE_COLOR)}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        color: normalizeStoreColor(e.target.value),
                      }))
                    }
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label={t('storeZoneColorCustom', {
                      defaultValue: 'Custom color',
                    })}
                  />
                </label>
              </div>
            </div>

            <button
              type="button"
              onClick={applyFiveKmRadius}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-cyan-400/45 bg-cyan-500/15 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-50"
            >
              <Circle className="h-3.5 w-3.5" aria-hidden />
              {t('storeRadius5km', {
                defaultValue: 'Use 5 km radius',
              })}
            </button>

            <StoreCoverageMap
              officeLat={draft.office_lat}
              officeLng={draft.office_lng}
              polygon={draft.service_radius_polygon}
              zoneColor={draft.color}
              onOfficeChange={(lat, lng) =>
                setDraft((p) => ({ ...p, office_lat: lat, office_lng: lng }))
              }
              onPolygonChange={(poly) =>
                setDraft((p) => ({ ...p, service_radius_polygon: poly }))
              }
            />
            <label className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              {t('storeAddressLabel', { defaultValue: 'Office address' })}
            </label>
            <input
              type="text"
              value={draft.office_address}
              onChange={(e) =>
                setDraft((p) => ({ ...p, office_address: e.target.value }))
              }
              maxLength={200}
              placeholder={t('storeAddressPlaceholder', {
                defaultValue: 'Street, building, city',
              })}
              className={`w-full ${PROFILE_GLASS_PANEL} bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400/50`}
            />
          </section>
        </div>
      )}

      {/* ─── Step 3: Publish Checklist ─── */}
      {step === 3 && (
        <div className="space-y-4">
          <section
            className={`space-y-3 rounded-xl border p-3 ${PROFILE_GLASS_PANEL} ${
              publishChecklist.canPublish
                ? 'border-emerald-400/35 bg-emerald-500/10'
                : 'border-white/15 bg-black/20'
            }`}
          >
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
              {t('storePublishChecklist', {
                defaultValue: 'Publish checklist',
              })}
            </p>
            <ul className="space-y-2">
              {checklistItems.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={item.go}
                    className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-left transition-colors hover:border-white/25"
                  >
                    <span
                      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                        item.ok
                          ? 'border-emerald-400/50 bg-emerald-500/25 text-emerald-200'
                          : 'border-red-400/45 bg-red-500/15 text-red-300'
                      }`}
                    >
                      {item.ok ? (
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <X className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        item.ok ? 'text-emerald-100' : 'text-red-200/90'
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!publishChecklist.canPublish && (
              <p className="text-[11px] leading-relaxed text-amber-200/85">
                {t('storePublishGateHint', {
                  defaultValue:
                    'Publish unlocks when all items are green. Tap a row to jump back and fix it.',
                })}
              </p>
            )}
          </section>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={saving || uploading}
              onClick={() => void handleSave(false)}
              className="flex-1 rounded-full border border-white/20 bg-white/5 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-slate-200 disabled:opacity-50"
            >
              {saving
                ? t('processing')
                : t('storeSaveDraft', { defaultValue: 'Save draft' })}
            </button>
            <button
              type="button"
              disabled={saving || uploading || !publishChecklist.canPublish}
              onClick={() => void handleSave(true)}
              className="flex-1 rounded-full border border-emerald-400/50 bg-emerald-500/25 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.25)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving
                ? t('processing')
                : t('storePublish', { defaultValue: 'Publish store' })}
            </button>
          </div>

          {/* Optional advanced tools — collapsed by default */}
          <div className="space-y-2 border-t border-white/10 pt-3">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              {t('storeAdvancedTools', {
                defaultValue: 'Advanced (optional)',
              })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  {
                    id: 'inventory' as const,
                    label: t('storeTabInventory', { defaultValue: 'Inventory' }),
                    icon: <Package className="h-3.5 w-3.5" />,
                  },
                  {
                    id: 'bundles' as const,
                    label: t('storeTabBundles', { defaultValue: 'Bundles' }),
                    icon: <Sparkles className="h-3.5 w-3.5" />,
                  },
                  {
                    id: 'recurring' as const,
                    label: t('storeTabRecurring', { defaultValue: 'Recurring' }),
                    icon: <RefreshCw className="h-3.5 w-3.5" />,
                  },
                ] as const
              ).map((item) => {
                const active = advancedTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      setAdvancedTab((prev) => (prev === item.id ? null : item.id))
                    }
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] transition-colors ${
                      active
                        ? 'border-violet-400/55 bg-violet-500/25 text-violet-100'
                        : 'border-white/12 bg-white/5 text-slate-400 hover:border-white/25'
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                );
              })}
            </div>

            {advancedTab === 'inventory' && (
              <div className="space-y-3 pt-2">
                <p className="text-[11px] leading-relaxed text-slate-400">
                  {t('storeInventoryHint', {
                    defaultValue:
                      'Showcase detergents, chemicals, and equipment you bring — mark free inclusions vs paid add-ons.',
                  })}
                </p>
                <div className={`space-y-2 rounded-xl border border-cyan-400/25 bg-cyan-500/5 p-3 ${PROFILE_GLASS_PANEL}`}>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200/80">
                    {t('storeSupplyAddTitle', { defaultValue: 'Add supply item' })}
                  </p>
                  <input
                    type="text"
                    value={supplyDraft.name}
                    onChange={(e) =>
                      setSupplyDraft((p) => ({ ...p, name: e.target.value }))
                    }
                    maxLength={120}
                    placeholder={t('storeSupplyNamePlaceholder', {
                      defaultValue: 'Product name',
                    })}
                    className={`w-full ${PROFILE_GLASS_PANEL} bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50`}
                  />
                  <input
                    type="text"
                    value={supplyDraft.brand}
                    onChange={(e) =>
                      setSupplyDraft((p) => ({ ...p, brand: e.target.value }))
                    }
                    maxLength={80}
                    placeholder={t('storeSupplyBrandPlaceholder', {
                      defaultValue: 'Brand (optional)',
                    })}
                    className={`w-full ${PROFILE_GLASS_PANEL} bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50`}
                  />
                  <select
                    value={supplyDraft.category}
                    onChange={(e) =>
                      setSupplyDraft((p) => ({
                        ...p,
                        category: e.target.value as SupplyCategory,
                      }))
                    }
                    className={`w-full ${PROFILE_GLASS_PANEL} bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50`}
                  >
                    {SUPPLY_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat} className="bg-slate-900">
                        {cat}
                      </option>
                    ))}
                  </select>
                  <label className="flex cursor-pointer items-center gap-2 text-[11px] text-cyan-100">
                    <input
                      type="checkbox"
                      checked={supplyDraft.is_included_in_service}
                      onChange={(e) =>
                        setSupplyDraft((p) => ({
                          ...p,
                          is_included_in_service: e.target.checked,
                          extra_price: e.target.checked ? '' : p.extra_price,
                        }))
                      }
                    />
                    {t('storeSupplyIncludedToggle', {
                      defaultValue: 'Included free with service',
                    })}
                  </label>
                  {!supplyDraft.is_included_in_service && (
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={supplyDraft.extra_price === '' ? '' : supplyDraft.extra_price}
                      onChange={(e) =>
                        setSupplyDraft((p) => ({
                          ...p,
                          extra_price:
                            e.target.value === ''
                              ? ''
                              : Math.max(0, Math.floor(Number(e.target.value) || 0)),
                        }))
                      }
                      placeholder={t('storeSupplyExtraPrice', {
                        defaultValue: 'Add-on price (USD)',
                      })}
                      className={`w-full ${PROFILE_GLASS_PANEL} bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50`}
                    />
                  )}
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-200">
                    <Camera className="h-3.5 w-3.5" />
                    {supplyDraft.image_url
                      ? t('storeSupplyPhotoSet', { defaultValue: 'Photo attached' })
                      : t('storeSupplyAddPhoto', { defaultValue: 'Add photo' })}
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploading}
                      onChange={(e) => void onSupplyPhotoSelected(e)}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={saving || uploading}
                    onClick={() => void handleAddSupply()}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-cyan-400/45 bg-cyan-500/20 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-50 disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t('storeSupplyAddCta', { defaultValue: 'Add to inventory' })}
                  </button>
                </div>
                {supplies.length === 0 ? (
                  <p className="text-[11px] italic text-slate-500">
                    {t('storeSuppliesEmpty', { defaultValue: 'No supply items yet.' })}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {supplies.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 p-2"
                      >
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt=""
                            className="h-10 w-10 rounded object-cover"
                          />
                        ) : (
                          <Package className="h-5 w-5 text-cyan-500/50" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-white">{item.name}</p>
                          <p className="truncate text-[10px] text-slate-400">
                            {[item.brand, item.category].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRemoveSupply(item.id)}
                          className="rounded-full border border-red-400/40 p-1 text-red-200"
                          aria-label={t('remove', { defaultValue: 'Remove' })}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    {t('storeMaterialsSection', {
                      defaultValue: 'Materials & chemicals',
                    })}
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={materialInput}
                      onChange={(e) => setMaterialInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addMaterial();
                        }
                      }}
                      maxLength={80}
                      placeholder={t('storeMaterialPlaceholder', {
                        defaultValue: 'e.g. Eco detergent, HEPA vacuum…',
                      })}
                      className={`min-w-0 flex-1 ${PROFILE_GLASS_PANEL} bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50`}
                    />
                    <button
                      type="button"
                      onClick={addMaterial}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cyan-400/40 bg-cyan-500/15 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t('add', { defaultValue: 'Add' })}
                    </button>
                  </div>
                  {draft.materials_and_chemicals.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {draft.materials_and_chemicals.map((item) => (
                        <span
                          key={item}
                          className="inline-flex items-center gap-1 rounded-full border border-violet-400/35 bg-violet-500/15 px-2.5 py-1 text-[11px] font-medium text-violet-100"
                        >
                          {item}
                          <button
                            type="button"
                            onClick={() => removeMaterial(item)}
                            className="text-violet-200/80 hover:text-white"
                            aria-label={t('remove', { defaultValue: 'Remove' })}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {advancedTab === 'bundles' && (
              <div className="space-y-3 pt-2">
                <p className="text-[11px] leading-relaxed text-slate-400">
                  {t('storeBundlesHint', {
                    defaultValue:
                      'Package 2–3 services into a fixed starting-price deal for your storefront.',
                  })}
                </p>
                {draft.service_bundles.map((bundle) => (
                  <section
                    key={bundle.id}
                    className="space-y-2 rounded-xl border border-violet-400/30 bg-violet-500/10 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <input
                        type="text"
                        value={bundle.title}
                        onChange={(e) =>
                          updateBundle(bundle.id, { title: e.target.value })
                        }
                        maxLength={80}
                        placeholder={t('storeBundleTitlePlaceholder', {
                          defaultValue: 'Bundle title',
                        })}
                        className={`min-w-0 flex-1 ${PROFILE_GLASS_PANEL} bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-violet-400/50`}
                      />
                      <button
                        type="button"
                        onClick={() => removeBundle(bundle.id)}
                        className="rounded-full border border-red-400/40 bg-red-500/20 p-1.5 text-red-100"
                        aria-label={t('remove', { defaultValue: 'Remove' })}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <textarea
                      value={bundle.description}
                      onChange={(e) =>
                        updateBundle(bundle.id, { description: e.target.value })
                      }
                      maxLength={400}
                      rows={2}
                      placeholder={t('storeBundleDescPlaceholder', {
                        defaultValue: 'What’s included…',
                      })}
                      className={`w-full resize-none ${PROFILE_GLASS_PANEL} bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-violet-400/50`}
                    />
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={bundle.starting_price || ''}
                      onChange={(e) =>
                        updateBundle(bundle.id, {
                          starting_price: Math.max(
                            0,
                            Math.floor(Number(e.target.value) || 0)
                          ),
                        })
                      }
                      placeholder={t('storeBundlePricePlaceholder', {
                        defaultValue: 'Starting price (USD)',
                      })}
                      className={`w-full ${PROFILE_GLASS_PANEL} bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-violet-400/50`}
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_SECTOR_SERVICES.map((svc) => {
                        const active = bundle.service_ids.includes(svc.id);
                        return (
                          <button
                            key={svc.id}
                            type="button"
                            onClick={() => toggleBundleService(bundle.id, svc.id)}
                            className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ${
                              active
                                ? 'border-violet-400/55 bg-violet-500/30 text-violet-50'
                                : 'border-white/12 bg-white/5 text-slate-400'
                            }`}
                          >
                            {t(svc.labelKey)}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
                <button
                  type="button"
                  disabled={draft.service_bundles.length >= STORE_BUNDLES_MAX}
                  onClick={addBundle}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-violet-400/45 bg-violet-500/20 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-violet-50 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('storeBundleAddCta', { defaultValue: 'Create bundle' })}
                </button>
              </div>
            )}

            {advancedTab === 'recurring' && (
              <div className="space-y-4 pt-2">
                <p className="text-[11px] leading-relaxed text-slate-400">
                  {t('storeRecurringHint', {
                    defaultValue:
                      'Signal that you accept regular weekly / monthly clients (Subscribe & Save showcase).',
                  })}
                </p>
                <label className="flex items-center justify-between gap-3 rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-3">
                  <div>
                    <p className="text-sm font-bold text-white">
                      {t('storeRecurringToggle', {
                        defaultValue: 'Accept recurring clients',
                      })}
                    </p>
                    <p className="mt-0.5 text-[11px] text-fuchsia-100/75">
                      {t('storeRecurringToggleHint', {
                        defaultValue:
                          'Shown on your public storefront as Subscribe & Save.',
                      })}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={acceptsRecurring}
                    onClick={() => setAcceptsRecurring(!acceptsRecurring)}
                    className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
                      acceptsRecurring
                        ? 'border-fuchsia-400/60 bg-fuchsia-500/40'
                        : 'border-white/20 bg-white/10'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                        acceptsRecurring ? 'left-6' : 'left-0.5'
                      }`}
                    />
                  </button>
                </label>
                {acceptsRecurring && (
                  <div className="flex flex-wrap gap-1.5">
                    {RECURRENCE_TYPES.filter((r) => r !== 'one_time').map((r) => {
                      const active = draft.supported_recurrence_types.includes(r);
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => toggleRecurrence(r)}
                          className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${
                            active
                              ? 'border-fuchsia-400/55 bg-fuchsia-500/25 text-fuchsia-50'
                              : 'border-white/12 bg-white/5 text-slate-400'
                          }`}
                        >
                          {t(recurrenceLabelKey(r), { defaultValue: r })}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <p
          className={`text-xs font-medium ${
            errorIsSoft ? 'text-amber-300' : 'text-red-400'
          }`}
        >
          {error}
        </p>
      )}
      {success && <p className="text-xs font-medium text-emerald-400">{success}</p>}

      {/* Wizard navigation */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={step === 1}
          onClick={() => setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s))}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-full border border-white/15 bg-white/5 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-200 disabled:opacity-35"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          {t('storeWizardBack', { defaultValue: 'Back' })}
        </button>
        {step < 3 ? (
          <button
            type="button"
            onClick={() => {
              void handleSave(false);
              setStep((s) => (s < 3 ? ((s + 1) as WizardStep) : s));
            }}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-full border border-emerald-400/45 bg-emerald-500/20 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-50"
          >
            {t('storeWizardNext', { defaultValue: 'Next' })}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            disabled={saving || uploading}
            onClick={() => void handleSave(false)}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-full border border-white/20 bg-white/5 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-200 disabled:opacity-50"
          >
            {saving
              ? t('processing')
              : t('storeSaveDraft', { defaultValue: 'Save draft' })}
          </button>
        )}
      </div>

      {draft.is_published && (
        <div className="space-y-2">
          <p className="text-center text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300/90">
            {t('storePublishedBadge', { defaultValue: 'Storefront is live' })}
          </p>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                const { shareStoreLink } = await import('../src/lib/trustBadges');
                const result = await shareStoreLink({
                  ownerId: userId,
                  storeName: draft.store_name,
                  t,
                });
                if (result === 'copied' || result === 'shared') {
                  setSuccess(
                    result === 'copied'
                      ? t('storeShareCopied', {
                          defaultValue: 'Store link copied.',
                        })
                      : t('storeShareDone', { defaultValue: 'Shared!' })
                  );
                }
              })();
            }}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-violet-400/45 bg-violet-500/20 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-violet-50"
          >
            {t('storeShareCta', { defaultValue: 'Share Store' })}
          </button>
        </div>
      )}

      {(draft.is_published || storeId) && (
        <div className="space-y-2 border-t border-gray-800 pt-4">
          {draft.is_published && (
            <button
              type="button"
              disabled={saving || uploading}
              onClick={() => void handleUnpublish()}
              className="inline-flex w-full items-center justify-center rounded-full border border-amber-500/35 bg-amber-500/5 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-amber-200 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
            >
              {saving
                ? t('processing')
                : t('storeUnpublish', { defaultValue: 'Unpublish Store' })}
            </button>
          )}
          {storeId && (
            <button
              type="button"
              disabled={saving || uploading}
              onClick={() => void handleDeleteStore()}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-red-500/40 bg-red-950/20 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-red-400 shadow-[0_0_14px_rgba(239,68,68,0.12)] transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {saving
                ? t('processing')
                : t('storeDeletePermanent', {
                    defaultValue: 'Delete Store Permanently',
                  })}
            </button>
          )}
        </div>
      )}

      {draft.store_service_skus.length > 0 && (
        <p className="sr-only">
          {draft.store_service_skus
            .map((s) => findServiceOption(s.id)?.labelKey)
            .filter(Boolean)
            .join(', ')}
        </p>
      )}
    </div>
  );
};

export default ContractorStorePanel;
