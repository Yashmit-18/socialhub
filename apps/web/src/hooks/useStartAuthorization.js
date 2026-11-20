import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../lib/api.js';
import { redirectTo } from '../lib/browser.js';

/**
 * Starts a Meta OAuth round-trip. The API stores a hashed single-use state, sets an
 * httpOnly browser-binding cookie, and returns Meta's consent URL; the browser then
 * navigates there. Tokens never pass through the web app.
 */
export function useStartAuthorization(workspaceId) {
  return useMutation({
    mutationFn: (body) => api.post(`/workspaces/${workspaceId}/meta/authorizations`, body),
    onSuccess: ({ authorizationUrl }) => redirectTo(authorizationUrl),
    onError: (err) => toast.error(err.message),
  });
}
