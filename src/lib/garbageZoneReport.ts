import imageCompression from 'browser-image-compression';
import { supabase } from '../../services/supabase';
import {
  filterMissionDescription,
  validateMissionDescription,
} from './missionContentPolicy';
import {
  MISSION_SHORT_DESCRIPTION_MAX,
  processMissionDescription,
} from './missionDescription';
import { isGarbageRemovalService } from './crowdfunding';

const COMPRESSION = {
  maxSizeMB: 0.4,
  maxWidthOrHeight: 1280,
  useWebWorker: true,
  fileType: 'image/jpeg' as const,
};

export function isGarbageZoneReport(mission: {
  is_report?: boolean | null;
  status?: string | null;
}): boolean {
  if (mission.is_report) return true;
  return String(mission.status || '').toLowerCase() === 'reported';
}

async function uploadReportPhoto(file: File): Promise<string> {
  if (!file.type || !file.type.startsWith('image/')) {
    throw new Error('Only images are allowed');
  }
  let fileToUpload: File | Blob = file;
  try {
    fileToUpload = await imageCompression(file, COMPRESSION);
  } catch (err) {
    console.warn('[garbageZoneReport] compression failed', err);
  }
  const safeFileName = `report_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await supabase.storage
    .from('order-photos')
    .upload(safeFileName, fileToUpload, { upsert: false, contentType: 'image/jpeg' });
  if (error) throw error;
  const {
    data: { publicUrl },
  } = supabase.storage.from('order-photos').getPublicUrl(safeFileName);
  return publicUrl;
}

export async function createGarbageZoneReport(input: {
  lat: number;
  lng: number;
  description: string;
  photoFile: File;
  serviceType?: string;
}): Promise<string> {
  const raw = input.description.trim().slice(0, MISSION_SHORT_DESCRIPTION_MAX);
  if (raw.length > 0) {
    const policy = validateMissionDescription(raw);
    if (!policy.ok) {
      throw new Error('error' in policy ? policy.error : 'Invalid description');
    }
  }
  const { filteredText } = filterMissionDescription(raw);
  const serviceType =
    input.serviceType && isGarbageRemovalService(input.serviceType)
      ? input.serviceType
      : 'beach_street_cleanup';
  const body =
    processMissionDescription(filteredText.trim() || raw || '#GarbageZone', serviceType) ||
    '#GarbageZone Needs attention';

  const photoUrl = await uploadReportPhoto(input.photoFile);

  const { data, error } = await supabase.rpc('create_garbage_zone_report', {
    p_location_lat: input.lat,
    p_location_lng: input.lng,
    p_description: body,
    p_photo_urls: [photoUrl],
    p_service_type: serviceType,
  });

  if (error) throw error;
  const id = Array.isArray(data) ? data[0] : data;
  if (!id) throw new Error('Report create returned no id');
  return String(id);
}

export type ConvertedMissionRow = {
  id: string;
  status: string;
  is_report: boolean;
  crowdfunding_mode: boolean;
  expected_price: number | null;
  amount_target: number | null;
  current_funding: number | null;
  crowdfunding_expires_at: string | null;
};

export async function convertReportToMission(input: {
  missionId: string;
  expectedPriceUsd: number;
  crowdfundingMode?: boolean;
}): Promise<ConvertedMissionRow> {
  const price = Math.floor(Number(input.expectedPriceUsd) || 0);
  if (price < 5) throw new Error('Target budget must be at least $5');

  const { data, error } = await supabase.rpc('convert_report_to_mission', {
    p_mission_id: input.missionId,
    p_expected_price: price,
    p_crowdfunding_mode: input.crowdfundingMode !== false,
  });

  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as ConvertedMissionRow | null;
  if (!row?.id) throw new Error('Conversion returned no mission');
  return row;
}
