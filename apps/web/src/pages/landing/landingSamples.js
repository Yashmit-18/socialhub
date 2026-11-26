/**
 * Sample content for the landing illustrations (LandingSocial.jsx). One fictional cast, the
 * same one LandingVisuals.jsx uses. Honesty rule for every list here: "Published" and
 * "Scheduled" are for Facebook Pages only; an Instagram entry is "Preview" or "Draft".
 */

/** The same post on both platforms: [0] the Facebook Page, [1] Instagram. */
export const HERO_POSTS = [
  {
    kind: 'facebook',
    name: 'Bloom Bakery',
    sub: 'Facebook Page',
    photo: 'buns',
    status: ['mint', 'Published'],
  },
  {
    kind: 'instagram',
    name: 'bloom.bakes',
    sub: 'Instagram',
    photo: 'buns',
    status: ['slate', 'Preview'],
  },
];

/** Marquee chips. Neighbours never share a picture, also across the loop's seam. */
export const POST_CHIPS = [
  { title: 'Autumn menu', kind: 'facebook', photo: 'buns', status: ['mint', 'Published'] },
  { title: 'Pumpkin latte', kind: 'instagram', photo: 'latte', status: ['slate', 'Preview'] },
  { title: 'Weekend hours', kind: 'facebook', photo: 'sunset', status: ['indigo', 'Scheduled'] },
  { title: 'Friday bake', kind: 'instagram', photo: 'buns', status: ['slate', 'Draft'] },
  { title: 'New roast', kind: 'facebook', photo: 'latte', status: ['mint', 'Published'] },
  { title: 'Sunset seats', kind: 'instagram', photo: 'sunset', status: ['slate', 'Preview'] },
  { title: 'Cinnamon buns', kind: 'facebook', photo: 'buns', status: ['indigo', 'Scheduled'] },
  { title: 'Latte art class', kind: 'instagram', photo: 'latte', status: ['slate', 'Draft'] },
  { title: 'Golden hour', kind: 'facebook', photo: 'sunset', status: ['mint', 'Published'] },
  { title: 'Open late', kind: 'facebook', photo: 'latte', status: ['slate', 'Draft'] },
];

/** The feed phone. No status: the phone itself is headed "Preview · Not published". */
export const FEED_POSTS = [
  { kind: 'facebook', name: 'Bloom Bakery', sub: 'Facebook Page', photo: 'buns' },
  { kind: 'instagram', name: 'bloom.bakes', sub: 'Instagram', photo: 'latte' },
  { kind: 'facebook', name: 'Northwind Coffee', sub: 'Facebook Page', photo: 'sunset' },
];

/**
 * Group sharing tasks for one published Page post. `by` is the teammate who shared it by hand;
 * null is still to share. `tint` colours the group's initials tile.
 */
export const GROUP_TASKS = [
  {
    group: 'Neighbourhood Foodies',
    initials: 'NF',
    tint: 'from-sky-500 to-indigo-500',
    by: { initials: 'PR', name: 'Priya', tint: 'from-amber-400 to-pink-500' },
  },
  {
    group: 'Weekend Markets',
    initials: 'WM',
    tint: 'from-emerald-400 to-teal-500',
    by: { initials: 'DS', name: 'Dev', tint: 'from-indigo-500 to-violet-500' },
  },
  { group: 'Local Bakers', initials: 'LB', tint: 'from-violet-500 to-fuchsia-500', by: null },
];

/** Five recorded sync attempts; the third met a temporary Meta failure and was retried. */
export const SYNC_RUNS = ['ok', 'ok', 'retry', 'ok', 'ok'];
