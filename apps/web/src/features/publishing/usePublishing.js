/**
 * Data hooks for the Publishing screen. Everything shown comes from these API calls; nothing
 * is assumed or changed locally before the server has answered.
 */
import { ACTIVE_JOB_STATUSES, PUBLISHING_API_ERRORS, PUBLISH_JOB_STATUS } from '@socialhub/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';

/** How often lists refresh while something is being sent, or is about to be. */
export const LIVE_INTERVAL_MS = 4_000;
export const STATUS_INTERVAL_MS = 30_000;
/** A scheduled post waiting for a later time is refreshed this often (it may be moved). */
export const SCHEDULED_INTERVAL_MS = 60_000;
/** A scheduled post due within this long is refreshed like one being sent. */
export const DUE_SOON_MS = 2 * 60_000;

const PAGE_SIZE = 20;

// Every key starts with publishingKeys.all(id): invalidate that prefix to refresh the screen.
export const publishingKeys = {
  all: (id) => ['workspace', id, 'publishing'],
  status: (id) => ['workspace', id, 'publishing', 'status'],
  summary: (id) => ['workspace', id, 'publishing', 'summary'],
  jobs: (id) => ['workspace', id, 'publishing', 'jobs'],
  jobList: (id, status, order) => [
    'workspace',
    id,
    'publishing',
    'jobs',
    status ?? 'ALL',
    order ?? 'newest',
  ],
  job: (id, jobId) => ['workspace', id, 'publishing', 'job', jobId],
  drafts: (id) => ['workspace', id, 'publishing', 'drafts'],
};

const base = (workspaceId) => `/workspaces/${workspaceId}`;

export const isActiveJob = (job) => ACTIVE_JOB_STATUSES.includes(job?.status);

/**
 * How often a job's data needs refreshing: every few seconds while it is being sent or is due
 * within DUE_SOON_MS, once a minute while it waits for a later time, never once it finished.
 */
export function refreshIntervalFor(job, now = Date.now()) {
  if (!isActiveJob(job)) return false;
  if (job.status !== PUBLISH_JOB_STATUS.SCHEDULED) return LIVE_INTERVAL_MS;
  const at = Date.parse(job.scheduledAt ?? '');
  return Number.isFinite(at) && at - now > DUE_SOON_MS ? SCHEDULED_INTERVAL_MS : LIVE_INTERVAL_MS;
}

/** The most frequent refresh any of `jobs` needs, or false when none needs one. */
export function refreshIntervalForJobs(jobs, now = Date.now()) {
  const intervals = jobs.map((job) => refreshIntervalFor(job, now)).filter(Boolean);
  return intervals.length ? Math.min(...intervals) : false;
}

/** `refetchInterval` for a job list (see refreshIntervalFor). */
export function liveListInterval(query) {
  const pages = query.state.data?.pages ?? [];
  return refreshIntervalForJobs(pages.flatMap((page) => page.items ?? []));
}

export function usePublishingStatus(workspaceId, { enabled = true } = {}) {
  return useQuery({
    queryKey: publishingKeys.status(workspaceId),
    queryFn: () => api.get(`${base(workspaceId)}/publishing/status`),
    refetchInterval: STATUS_INTERVAL_MS,
    enabled,
  });
}

/** `{ counts, total }`. `interval` keeps it in step with the list (refreshIntervalForJobs). */
export function usePublishJobSummary(workspaceId, { enabled = true, interval = false } = {}) {
  return useQuery({
    queryKey: publishingKeys.summary(workspaceId),
    queryFn: () => api.get(`${base(workspaceId)}/publish-jobs/summary`),
    refetchInterval: interval,
    enabled,
  });
}

function useJobPages(workspaceId, status, order, enabled) {
  return useInfiniteQuery({
    queryKey: publishingKeys.jobList(workspaceId, status, order),
    queryFn: ({ pageParam }) =>
      api.get(`${base(workspaceId)}/publish-jobs`, {
        query: { status, order, cursor: pageParam, limit: PAGE_SIZE },
      }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: liveListInterval,
    staleTime: 0,
    enabled,
  });
}

const byNewest = (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

/**
 * Jobs for a tab. The list endpoint takes one status, so a tab with two statuses is two
 * requests whose results are merged, newest first. `order: 'scheduled'` lists scheduled jobs
 * soonest first (one status only).
 */
export function usePublishJobs(workspaceId, statuses = [], { enabled = true, order } = {}) {
  const first = useJobPages(workspaceId, statuses[0], order, enabled);
  const second = useJobPages(workspaceId, statuses[1], order, enabled && statuses.length > 1);
  const queries = statuses.length > 1 ? [first, second] : [first];

  const seen = new Set();
  const items = queries
    .flatMap((q) => q.data?.pages.flatMap((page) => page.items) ?? [])
    .filter((job) => (seen.has(job.id) ? false : seen.add(job.id)));
  if (queries.length > 1) items.sort(byNewest);

  return {
    items,
    isPending: queries.some((q) => q.isPending),
    error: queries.find((q) => q.error)?.error ?? null,
    hasNextPage: queries.some((q) => q.hasNextPage),
    isFetchingNextPage: queries.some((q) => q.isFetchingNextPage),
    fetchNextPage: () =>
      Promise.all(queries.filter((q) => q.hasNextPage).map((q) => q.fetchNextPage())),
    refetch: () => Promise.all(queries.map((q) => q.refetch())),
  };
}

/** One job, kept fresh while it is open. `initial` is the copy already shown in the list. */
export function usePublishJob(workspaceId, jobId, { initial } = {}) {
  return useQuery({
    queryKey: publishingKeys.job(workspaceId, jobId),
    queryFn: () =>
      api.get(`${base(workspaceId)}/publish-jobs/${jobId}`).then((data) => data.publishJob),
    placeholderData: initial,
    refetchInterval: (query) => refreshIntervalFor(query.state.data),
    staleTime: 0,
    enabled: Boolean(jobId),
  });
}

/** Saved drafts that can be sent: `{ items, nextCursor }`. */
export function usePublishableDrafts(workspaceId, { enabled = true } = {}) {
  return useQuery({
    queryKey: publishingKeys.drafts(workspaceId),
    queryFn: () =>
      api.get(`${base(workspaceId)}/content-packages`, { query: { status: 'DRAFT', limit: 50 } }),
    staleTime: 0,
    retry: false,
    enabled,
  });
}

function useRefreshJobs(workspaceId) {
  const queryClient = useQueryClient();
  return (publishJob) => {
    if (publishJob?.id) {
      queryClient.setQueryData(publishingKeys.job(workspaceId, publishJob.id), publishJob);
    }
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: publishingKeys.jobs(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: publishingKeys.summary(workspaceId) }),
    ]);
  };
}

/**
 * `mutate({ contentPackageId, idempotencyKey, socialAccountIds?, scheduledAt?, republish?,
 * confirmRealPost? })` → `{ publishJob, created }`. Without `socialAccountIds` the draft's own
 * accounts are used; without `scheduledAt` (an ISO instant) the post is sent now.
 * `confirmRealPost` is sent only as `true`, when the person ticked "This creates a REAL public
 * post"; the API refuses a real post without it (REAL_POST_CONFIRMATION_REQUIRED).
 */
export function useCreatePublishJob(workspaceId) {
  const refresh = useRefreshJobs(workspaceId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      contentPackageId,
      idempotencyKey,
      socialAccountIds,
      scheduledAt,
      republish,
      confirmRealPost,
    }) =>
      api.post(`${base(workspaceId)}/publish-jobs`, {
        contentPackageId,
        idempotencyKey,
        ...(socialAccountIds?.length ? { socialAccountIds } : {}),
        ...(scheduledAt ? { scheduledAt } : {}),
        ...(republish ? { republish: true } : {}),
        ...(confirmRealPost === true ? { confirmRealPost: true } : {}),
      }),
    onSuccess: (data) => refresh(data.publishJob),
    onError: (error) => {
      // The screen believed the post would not be real: read the workspace's mode again, so
      // the dialog shows the real-post confirmation.
      if (error?.code === PUBLISHING_API_ERRORS.REAL_POST_CONFIRMATION_REQUIRED) {
        queryClient.invalidateQueries({ queryKey: publishingKeys.status(workspaceId) });
      }
    },
  });
}

/** `mutate({ jobId, scheduledAt })` moves the accounts still waiting to a new time. */
export function useRescheduleJob(workspaceId) {
  const refresh = useRefreshJobs(workspaceId);
  return useMutation({
    mutationFn: ({ jobId, scheduledAt }) =>
      api.patch(`${base(workspaceId)}/publish-jobs/${jobId}/schedule`, { scheduledAt }),
    onSuccess: (data) => refresh(data.publishJob),
  });
}

export function useCancelJob(workspaceId) {
  const refresh = useRefreshJobs(workspaceId);
  return useMutation({
    mutationFn: ({ jobId }) => api.post(`${base(workspaceId)}/publish-jobs/${jobId}/cancel`),
    onSuccess: (data) => refresh(data.publishJob),
  });
}

/** `mutate({ jobId, destinationId, acknowledgeDuplicateRisk? })` */
/**
 * `mutate({ jobId, destinationId, acknowledgeDuplicateRisk?, confirmRealPost? })`. A real
 * destination needs `confirmRealPost` (the person ticked "This creates a REAL public post");
 * one whose last attempt had an uncertain outcome also needs `acknowledgeDuplicateRisk`.
 */
export function useRetryDestination(workspaceId) {
  const refresh = useRefreshJobs(workspaceId);
  return useMutation({
    mutationFn: ({ jobId, destinationId, acknowledgeDuplicateRisk = false, confirmRealPost }) =>
      api.post(`${base(workspaceId)}/publish-jobs/${jobId}/destinations/${destinationId}/retry`, {
        ...(acknowledgeDuplicateRisk ? { acknowledgeDuplicateRisk: true } : {}),
        ...(confirmRealPost === true ? { confirmRealPost: true } : {}),
      }),
    onSuccess: (data) => refresh(data.publishJob),
  });
}

const postPath = (workspaceId, jobId, destinationId) =>
  `${base(workspaceId)}/publish-jobs/${jobId}/destinations/${destinationId}/post`;

/**
 * `mutate({ jobId, destinationId, message, confirmRealPost })` changes the text of a real,
 * published Facebook post on Facebook. `confirmRealPost` is sent only as `true` (the person
 * ticked the confirmation); the API refuses the change without it.
 */
export function useEditPublishedPost(workspaceId) {
  const refresh = useRefreshJobs(workspaceId);
  return useMutation({
    mutationFn: ({ jobId, destinationId, message, confirmRealPost }) =>
      api.patch(postPath(workspaceId, jobId, destinationId), {
        message,
        ...(confirmRealPost === true ? { confirmRealPost: true } : {}),
      }),
    onSuccess: (data) => refresh(data.publishJob),
  });
}

/** `mutate({ jobId, destinationId, confirmRealPost })` deletes a real Facebook post. */
export function useDeletePublishedPost(workspaceId) {
  const refresh = useRefreshJobs(workspaceId);
  return useMutation({
    mutationFn: ({ jobId, destinationId, confirmRealPost }) =>
      api.delete(
        postPath(workspaceId, jobId, destinationId),
        confirmRealPost === true ? { confirmRealPost: true } : {},
      ),
    onSuccess: (data) => refresh(data.publishJob),
  });
}

export function useCancelDestination(workspaceId) {
  const refresh = useRefreshJobs(workspaceId);
  return useMutation({
    mutationFn: ({ jobId, destinationId }) =>
      api.post(`${base(workspaceId)}/publish-jobs/${jobId}/destinations/${destinationId}/cancel`),
    onSuccess: (data) => refresh(data.publishJob),
  });
}
