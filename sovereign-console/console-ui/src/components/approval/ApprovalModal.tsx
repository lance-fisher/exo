'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, type ApprovalToken } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import TotpInput from '@/components/auth/TotpInput';
import DiffViewer from '@/components/files/DiffViewer';
import { Clock, Smartphone, Shield } from 'lucide-react';

interface ApprovalModalProps {
  approvalId: string;
  onClose: () => void;
}

export default function ApprovalModal({
  approvalId,
  onClose,
}: ApprovalModalProps) {
  const [approval, setApproval] = useState<ApprovalToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState(false);
  const [showTotp, setShowTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    api.approvals.get(approvalId).then(({ data }) => {
      if (data) setApproval(data);
      setLoading(false);
    });
  }, [approvalId]);

  // Expiry countdown
  useEffect(() => {
    if (!approval) return;
    function update() {
      const expires = new Date(approval!.expiresAt ?? approval!.expires_at).getTime();
      const diff = Math.max(0, expires - Date.now());
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    }
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [approval]);

  const handleApprove = useCallback(
    async (totpCode?: string) => {
      setActioning(true);
      setError(null);
      const { error: apiError } = await api.approvals.approve(
        approvalId,
        totpCode
      );
      if (apiError) {
        setError(apiError);
        setActioning(false);
        return;
      }
      onClose();
    },
    [approvalId, onClose]
  );

  const handleReject = useCallback(async () => {
    setActioning(true);
    await api.approvals.reject(approvalId);
    onClose();
  }, [approvalId, onClose]);

  const handleApproveClick = useCallback(() => {
    if (approval?.requiresTotp) {
      setShowTotp(true);
    } else {
      handleApprove();
    }
  }, [approval, handleApprove]);

  if (loading) {
    return (
      <Modal title="Approval Required" onClose={onClose}>
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
        </div>
      </Modal>
    );
  }

  if (!approval) {
    return (
      <Modal title="Approval Required" onClose={onClose}>
        <p className="text-sm text-text-muted">Approval token not found.</p>
      </Modal>
    );
  }

  return (
    <Modal
      title="Approval Required"
      onClose={onClose}
      actions={
        !showTotp ? (
          <>
            <Button
              variant="ghost"
              onClick={handleReject}
              disabled={actioning}
            >
              Reject
            </Button>
            <Button
              variant="primary"
              onClick={handleApproveClick}
              loading={actioning}
            >
              Approve
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {/* Status and timer */}
        <div className="flex items-center justify-between">
          <Badge
            variant={
              approval.status === 'pending'
                ? 'warning'
                : approval.status === 'approved'
                ? 'success'
                : 'danger'
            }
          >
            {approval.status}
          </Badge>
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <Clock className="h-3.5 w-3.5" />
            <span>Expires in {timeLeft}</span>
          </div>
        </div>

        {/* Action description */}
        <div>
          <p className="text-xs text-text-muted">Action</p>
          <p className="mt-0.5 text-sm text-text-primary">
            {approval.description}
          </p>
        </div>

        {/* Diff preview */}
        {(approval.redactedDiff || approval.diff) && (
          <div>
            <p className="mb-2 text-xs text-text-muted">Changes</p>
            <DiffViewer diff={approval.redactedDiff || approval.diff || ''} />
          </div>
        )}

        {/* iPhone approval indicator */}
        {approval.requiresIphone && (
          <div className="flex items-center gap-2 rounded-lg border border-accent-blue/20 bg-accent-blue/5 p-3">
            <Smartphone className="h-4 w-4 text-accent-blue" />
            <span className="text-sm text-accent-blue">
              Waiting for iPhone approval...
            </span>
          </div>
        )}

        {/* TOTP step-up */}
        {showTotp && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-accent-blue" />
              <span className="text-sm font-medium text-text-primary">
                Step-up verification required
              </span>
            </div>
            <TotpInput
              onComplete={(code) => handleApprove(code)}
              loading={actioning}
              error={error}
            />
          </div>
        )}

        {error && !showTotp && (
          <p className="text-sm text-accent-red">{error}</p>
        )}
      </div>
    </Modal>
  );
}
