import TokenPackModal from './TokenPackModal';

/**
 * Worker subscription checkout — same SaaS payment modal, subscription pre-selected.
 */
export default function SubscriptionModal({
  open,
  userId,
  onClose,
  onSuccess,
}: {
  open: boolean;
  userId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  return (
    <TokenPackModal
      open={open}
      userId={userId}
      onClose={onClose}
      onSuccess={onSuccess}
      initialMode="subscription"
    />
  );
}
