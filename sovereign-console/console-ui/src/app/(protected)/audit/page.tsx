'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, type AuditEntry, type AuditPage } from '@/lib/api';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import {
  Shield,
  CheckCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  Filter,
} from 'lucide-react';

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [auditData, setAuditData] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [chainValid, setChainValid] = useState<boolean | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  // Filters
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string | number> = { page, pageSize };
    if (eventTypeFilter) params.eventType = eventTypeFilter;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    const { data } = await api.audit.list(params);
    if (data) setAuditData(data);
    setLoading(false);
  }, [page, pageSize, eventTypeFilter, startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    api.audit.verifyChain().then(({ data }) => {
      if (data) setChainValid(data.valid);
    });
  }, []);

  const handleExport = useCallback(async () => {
    const params: Record<string, string> = { format: 'json' };
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    const { data } = await api.audit.export(params);
    if (data?.url) {
      window.open(data.url, '_blank');
    }
  }, [startDate, endDate]);

  const totalPages = auditData
    ? Math.ceil(auditData.total / pageSize)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            Audit Log
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Immutable record of all operations.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Chain integrity indicator */}
          {chainValid !== null && (
            <div className="flex items-center gap-1.5">
              {chainValid ? (
                <>
                  <CheckCircle className="h-4 w-4 text-accent-green" />
                  <span className="text-xs text-accent-green">Chain Intact</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-accent-red" />
                  <span className="text-xs text-accent-red">Chain Broken</span>
                </>
              )}
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="mr-1.5 h-4 w-4" />
            Filters
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport}>
            <Download className="mr-1.5 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                Event Type
              </label>
              <select
                value={eventTypeFilter}
                onChange={(e) => {
                  setEventTypeFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-blue focus:outline-none"
              >
                <option value="">All Events</option>
                <option value="auth">Authentication</option>
                <option value="task">Task Execution</option>
                <option value="file">File Access</option>
                <option value="device">Device Management</option>
                <option value="approval">Approvals</option>
                <option value="system">System</option>
              </select>
            </div>
            <Input
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
            />
            <Input
              label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </Card>
      )}

      {/* Table */}
      <Card padding="none">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                    Timestamp
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                    Event
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                    Action
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                    Device
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                    Integrity
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {auditData?.entries.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => setSelectedEntry(entry)}
                    className="cursor-pointer transition-colors hover:bg-surface-raised"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text-secondary">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="info">{entry.eventType}</Badge>
                    </td>
                    <td className="max-w-[300px] truncate px-4 py-3 text-sm text-text-primary">
                      {entry.action}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {entry.deviceName}
                    </td>
                    <td className="px-4 py-3">
                      {entry.integrityVerified ? (
                        <CheckCircle className="h-4 w-4 text-accent-green" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-accent-red" />
                      )}
                    </td>
                  </tr>
                ))}
                {auditData?.entries.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-12 text-center text-sm text-text-muted"
                    >
                      No audit entries found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <span className="text-xs text-text-muted">
              Page {page} of {totalPages} ({auditData?.total} entries)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Entry detail modal */}
      {selectedEntry && (
        <Modal
          title="Audit Entry Detail"
          onClose={() => setSelectedEntry(null)}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-text-muted">Timestamp</p>
                <p className="mt-0.5 font-mono text-sm text-text-primary">
                  {new Date(selectedEntry.timestamp).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Event Type</p>
                <div className="mt-0.5">
                  <Badge variant="info">{selectedEntry.eventType}</Badge>
                </div>
              </div>
              <div>
                <p className="text-xs text-text-muted">Device</p>
                <p className="mt-0.5 text-sm text-text-primary">
                  {selectedEntry.deviceName}
                </p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Integrity</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  {selectedEntry.integrityVerified ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-accent-green" />
                      <span className="text-sm text-accent-green">Verified</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-4 w-4 text-accent-red" />
                      <span className="text-sm text-accent-red">Failed</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs text-text-muted">Action</p>
              <p className="mt-0.5 text-sm text-text-primary">
                {selectedEntry.action}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Details</p>
              <p className="mt-0.5 text-sm text-text-secondary">
                {selectedEntry.details}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Chain Hash</p>
              <p className="mt-0.5 break-all font-mono text-xs text-text-muted">
                {selectedEntry.chainHash}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Previous Hash</p>
              <p className="mt-0.5 break-all font-mono text-xs text-text-muted">
                {selectedEntry.previousHash}
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
