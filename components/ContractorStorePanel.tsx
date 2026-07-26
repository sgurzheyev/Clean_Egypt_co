/**
 * Contractor "My Store" management panel — office pin, coverage zone,
 * offered services, materials/chemicals, and gallery photos.
 */
import React, { useCallback, useEffect, useState } from 'react';
import imageCompression from 'browser-image-compression';
import { Camera, Plus, Store, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PROFILE_GLASS_PANEL } from '../constants';
import {
  ALL_SECTOR_SERVICES,
  findServiceOption,
  type ServiceType,
} from '../src/lib/serviceSectors';
import {
  EMPTY_STORE_DRAFT,
  STORE_MATERIALS_MAX,
  STORE_PHOTOS_MAX,
  fetchContractorStore,
  storeToDraft,
  uploadStorePhoto,
  upsertContractorStore,
  type ContractorStoreDraft,
} from '../src/lib/contractorStore';
import StoreCoverageMap from './StoreCoverageMap';

export type ContractorStorePanelProps = {
  userId: string;
  /** Compact embed inside a Profile accordion. */
  embedded?: boolean;
};

const ContractorStorePanel: React.FC<ContractorStorePanelProps> = ({
  userId,
  embedded = true,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ContractorStoreDraft>({ ...EMPTY_STORE_DRAFT });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [materialInput, setMaterialInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const store = await fetchContractorStore(userId);
      setDraft(storeToDraft(store));
    } catch (err) {
      console.error('fetchContractorStore failed', err);
      setError(
        t('storeLoadFailed', {
          defaultValue: 'Could not load your store. Try again.',
        })
      );
    } finally {
      setLoading(false);
    }
  }, [t, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleService = (id: ServiceType) => {
    setDraft((prev) => {
      const exists = prev.offered_services.includes(id);
      return {
        ...prev,
        offered_services: exists
          ? prev.offered_services.filter((s) => s !== id)
          : [...prev.offered_services, id],
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
    try {
      const urls: string[] = [];
      for (const file of files.slice(0, remaining)) {
        const compressed = (await imageCompression(file, {
          maxSizeMB: 0.7,
          maxWidthOrHeight: 1600,
          useWebWorker: true,
          fileType: 'image/jpeg',
        })) as File;
        urls.push(await uploadStorePhoto(userId, compressed));
      }
      setDraft((prev) => ({
        ...prev,
        store_photos: [...prev.store_photos, ...urls].slice(0, STORE_PHOTOS_MAX),
      }));
    } catch (err) {
      console.error('store photo upload failed', err);
      setError(
        t('storePhotoUploadFailed', {
          defaultValue: 'Photo upload failed. Please try again.',
        })
      );
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

  const handleSave = async (publish?: boolean) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const next = {
        ...draft,
        is_published: typeof publish === 'boolean' ? publish : draft.is_published,
      };
      const saved = await upsertContractorStore(userId, next);
      setDraft(storeToDraft(saved));
      setSuccess(
        next.is_published
          ? t('storeSavedPublished', {
              defaultValue: 'Store saved and published.',
            })
          : t('storeSavedDraft', { defaultValue: 'Store draft saved.' })
      );
    } catch (err) {
      console.error('upsertContractorStore failed', err);
      setError(
        t('storeSaveFailed', {
          defaultValue: 'Could not save store. Check permissions and try again.',
        })
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <p className="text-sm italic text-slate-500">{t('loading')}</p>
    );
  }

  return (
    <div className={`space-y-5 ${embedded ? '' : 'p-4'}`}>
      {!embedded && (
        <div className="flex items-center gap-2">
          <Store className="h-5 w-5 text-emerald-400" />
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">
            {t('myStore', { defaultValue: 'My Store' })}
          </h2>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-slate-400">
        {t('storePanelHint', {
          defaultValue:
            'Build your business storefront: office location, coverage zone, services, materials, and photos.',
        })}
      </p>

      {/* Identity */}
      <section className="space-y-2">
        <label className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
          {t('storeNameLabel', { defaultValue: 'Store name' })}
        </label>
        <input
          type="text"
          value={draft.store_name}
          onChange={(e) => setDraft((p) => ({ ...p, store_name: e.target.value }))}
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
          onChange={(e) => setDraft((p) => ({ ...p, store_bio: e.target.value }))}
          maxLength={600}
          rows={3}
          placeholder={t('storeBioPlaceholder', {
            defaultValue: 'Team, hygiene standards, response time…',
          })}
          className={`w-full resize-none ${PROFILE_GLASS_PANEL} bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400/50`}
        />
      </section>

      {/* Map: office + zone */}
      <section className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
          {t('storeCoverageSection', { defaultValue: 'Office & coverage zone' })}
        </p>
        <StoreCoverageMap
          officeLat={draft.office_lat}
          officeLng={draft.office_lng}
          polygon={draft.service_radius_polygon}
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

      {/* Services */}
      <section className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
          {t('storeServicesSection', { defaultValue: 'Services offered' })}
        </p>
        <div className="flex flex-wrap gap-2">
          {ALL_SECTOR_SERVICES.map((svc) => {
            const active = draft.offered_services.includes(svc.id);
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
      </section>

      {/* Materials */}
      <section className="space-y-2">
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
      </section>

      {/* Photos */}
      <section className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
          {t('storePhotosSection', {
            defaultValue: 'Office / team / hygiene photos',
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
            {draft.store_photos.map((url) => (
              <div
                key={url}
                className="relative overflow-hidden rounded-lg border border-white/10 bg-slate-900"
              >
                <img src={url} alt="" className="h-24 w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(url)}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-red-400/50 bg-red-500/30 text-red-100"
                  aria-label={t('remove', { defaultValue: 'Remove' })}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && <p className="text-xs font-medium text-red-400">{error}</p>}
      {success && <p className="text-xs font-medium text-emerald-400">{success}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={saving || uploading}
          onClick={() => void handleSave(false)}
          className="flex-1 rounded-full border border-white/20 bg-white/5 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-slate-200 disabled:opacity-50"
        >
          {saving ? t('processing') : t('storeSaveDraft', { defaultValue: 'Save draft' })}
        </button>
        <button
          type="button"
          disabled={saving || uploading}
          onClick={() => void handleSave(true)}
          className="flex-1 rounded-full border border-emerald-400/50 bg-emerald-500/25 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.25)] disabled:opacity-50"
        >
          {saving
            ? t('processing')
            : t('storePublish', { defaultValue: 'Publish store' })}
        </button>
      </div>

      {draft.is_published && (
        <p className="text-center text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300/90">
          {t('storePublishedBadge', { defaultValue: 'Storefront is live' })}
        </p>
      )}

      {/* Read-only summary of selected service labels for a11y */}
      {draft.offered_services.length > 0 && (
        <p className="sr-only">
          {draft.offered_services
            .map((id) => findServiceOption(id)?.labelKey)
            .filter(Boolean)
            .join(', ')}
        </p>
      )}
    </div>
  );
};

export default ContractorStorePanel;
