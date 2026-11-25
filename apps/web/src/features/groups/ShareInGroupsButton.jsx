import { PUBLISHING_MODES, SOCIAL_PLATFORMS } from '@socialhub/shared';
import { UsersRound } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useAutoShare } from './api.js';
import { autoShareMessage } from './helpers.js';

/**
 * For a real post with Facebook Pages: sets up its group sharing tasks (safe to repeat).
 * Rendered only where the person can publish.
 */
export function ShareInGroupsButton({ job }) {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const autoShare = useAutoShare(workspace.id);
  const real = job?.mode === PUBLISHING_MODES.LIVE && !job?.simulated;
  const hasPage = (job?.destinations ?? []).some(
    (destination) => destination.platform === SOCIAL_PLATFORMS.FACEBOOK_PAGE,
  );
  if (!real || !hasPage) return null;
  return (
    <Button
      variant="secondary"
      loading={autoShare.isPending}
      onClick={() =>
        autoShare.mutate(job.id, {
          onSuccess: (result) => {
            const message = autoShareMessage(result);
            toast.success(message.title, { description: message.description });
            if (result.tasksCreated > 0 || result.share?.counts?.open > 0) {
              navigate(`/w/${workspace.slug}/groups`);
            }
          },
          onError: (err) => toast.error(err.message ?? 'Group sharing could not be set up.'),
        })
      }
    >
      <UsersRound className="h-4 w-4" aria-hidden="true" /> Share in groups
    </Button>
  );
}
