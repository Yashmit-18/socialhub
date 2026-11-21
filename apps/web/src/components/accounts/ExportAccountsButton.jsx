import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/Button.jsx';
import { download } from '../../lib/api.js';
import { saveBlob } from '../../lib/accountOrganization.js';

const EXPORT_KEYS = [
  'q',
  'platform',
  'status',
  'readiness',
  'attention',
  'connectionId',
  'workspaceId',
  'label',
  'starred',
  'sort',
];

/**
 * Downloads the accounts matching the current filters as a CSV file (every page, not just the
 * one on screen). `path` is the export endpoint of the workspace or of all workspaces; the
 * server applies the same access rules as the listing.
 */
export function ExportAccountsButton({ path, params, className }) {
  const [busy, setBusy] = useState(false);
  const query = Object.fromEntries(
    EXPORT_KEYS.filter((key) => params?.[key]).map((key) => [key, params[key]]),
  );
  const run = async () => {
    setBusy(true);
    try {
      const { blob, fileName } = await download(path, { query });
      saveBlob(blob, fileName ?? 'socialhub-accounts.csv');
      toast.success('Export downloaded');
    } catch (error) {
      toast.error(error?.message ?? 'The export could not be downloaded. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="secondary"
      size="sm"
      className={className}
      loading={busy}
      onClick={run}
      title="Download the accounts matching these filters as a CSV file"
    >
      {!busy && <Download className="h-3.5 w-3.5" aria-hidden="true" />} Export CSV
    </Button>
  );
}
