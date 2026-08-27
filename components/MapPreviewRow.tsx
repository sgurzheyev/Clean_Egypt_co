/**
 * Marks a list row as a live-map preview target.
 * Hover / keyboard focus flies the globe; the parent scroller handles scroll.
 */
import React from 'react';
import {
  dispatchPreviewMissionLocation,
  isPreviewableCoord,
} from '../src/lib/listMapPreview';

type Props = {
  lat?: number | null;
  lng?: number | null;
  missionId?: string | null;
  className?: string;
  children: React.ReactNode;
};

const MapPreviewRow: React.FC<Props> = ({
  lat,
  lng,
  missionId,
  className,
  children,
}) => {
  const canPreview = isPreviewableCoord(lat, lng);
  const preview = () => {
    if (!canPreview) return;
    dispatchPreviewMissionLocation(lat, lng, missionId ?? undefined);
  };

  return (
    <div
      className={className}
      data-map-preview-lat={canPreview ? String(lat) : undefined}
      data-map-preview-lng={canPreview ? String(lng) : undefined}
      data-map-preview-id={missionId ? String(missionId) : undefined}
      onMouseEnter={preview}
      onFocusCapture={preview}
    >
      {children}
    </div>
  );
};

export default MapPreviewRow;
