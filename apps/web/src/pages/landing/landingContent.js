/**
 * Copy for the public landing page. Every claim here mirrors what the product actually does
 * today (README.md, docs/ARCHITECTURE.md, docs/META_SETUP_GUIDE.md, packages/shared/src/roles.js).
 * Publishing and scheduling to Facebook Pages are built and were verified with real posts on
 * 2026-11-24. Instagram publishing is built but not yet verified with a real Instagram
 * account, and people without a role on the Meta app can connect only after Meta's App Review.
 * Keep this file in sync with those references when features change.
 */
import {
  Activity,
  BadgeCheck,
  Bookmark,
  Building2,
  CalendarClock,
  Eye,
  FileLock2,
  Fingerprint,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Lock,
  MessageCircle,
  Plug,
  RefreshCw,
  ScrollText,
  Settings,
  Share2,
  ShieldCheck,
  SquarePen,
  TrendingUp,
  UserCog,
  UserRound,
  Users,
} from 'lucide-react';

export const NAV_LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#tour', label: 'Product tour' },
  { href: '#security', label: 'Security' },
  { href: '#roadmap', label: 'Roadmap' },
  { href: '#faq', label: 'FAQ' },
];

export const MARQUEE_ITEMS = [
  'Official Meta Graph API',
  'Facebook Login for Business',
  'Instagram Login',
  'AES-256-GCM encrypted tokens',
  'Least-privilege team access',
  'Owner · Admin · Editor · Viewer',
  'Token health & sync history',
  'Facebook & Instagram previews',
  'Version-safe team drafts',
  'Verified media uploads',
  'Full activity log',
  'Combined follower totals',
];

/** Product facts, not customer metrics. */
export const STATS = [
  {
    value: 0,
    suffix: '',
    label: 'Client passwords you ever need to see',
    note: 'Official Meta login only',
  },
  {
    value: 256,
    suffix: '-bit',
    label: 'AES-GCM encryption on every token',
    note: 'Never sent to the browser',
  },
  {
    value: 4,
    suffix: '',
    label: 'Team roles with a strict hierarchy',
    note: 'Owner, Admin, Editor, Viewer',
  },
  {
    value: 2,
    suffix: '',
    label: 'Official Meta login flows supported',
    note: 'Facebook & Instagram',
  },
];

export const PAINS = [
  {
    pain: 'Client passwords in spreadsheets',
    fix: 'Clients sign in on Meta’s own screen. SocialHub receives an access token, never a password.',
  },
  {
    pain: 'Connections that silently expire',
    fix: 'Every account shows its health: token expiry, revoked access and missing permissions, with the fix.',
  },
  {
    pain: 'Everyone can see every client',
    fix: 'Editors and viewers start with no accounts. You assign exactly the brands each person handles.',
  },
  {
    pain: '“Who changed this?”',
    fix: 'Every team, account and draft change is written to the activity log, in the same transaction.',
  },
];

/** Bento grid. `where` names the place in the app the feature lives. */
export const FEATURES = [
  {
    icon: Building2,
    title: 'A workspace for every client',
    body: 'Give each brand or client its own workspace with its own team, accounts, time zone and history. Switch between them in one click.',
    where: 'Onboarding · Settings',
    size: 'wide',
  },
  {
    icon: Plug,
    title: 'Connect with official Meta login',
    body: 'Facebook Login for Business finds every Page a person manages plus the Instagram accounts linked to them. Instagram Login connects Business or Creator accounts directly, no Page needed.',
    where: 'Social accounts › Logins',
    size: 'tall',
  },
  {
    icon: Gauge,
    title: 'Health on every account',
    body: 'Token and data-access expiry, granted and declined permissions, Page roles and reachability, all checked on every read.',
    where: 'Social accounts › Overview',
  },
  {
    icon: RefreshCw,
    title: 'Sync with a full history',
    body: 'Sync one login or all of them. Each attempt is recorded, temporary Meta failures are retried once, and nothing is ever duplicated.',
    where: 'Login detail',
  },
  {
    icon: TrendingUp,
    title: 'Combined followers',
    body: 'Follower counts read from Meta for every Page and Instagram account: a Facebook total, an Instagram total and both combined on your dashboard. Unknown counts show as “—”, never a made-up 0.',
    where: 'Overview',
  },
  {
    icon: SquarePen,
    title: 'One composer for every destination',
    body: 'Drag in images and video, write one caption or tailor it per platform, add hashtags, a first comment and alt text, then preview it as Facebook and Instagram would show it.',
    where: 'Create post',
    size: 'wide',
  },
  {
    icon: UserCog,
    title: 'Least-privilege team access',
    body: 'Owners and admins see everything. Everyone else sees only the accounts you assign, per member, per account or in the invitation itself.',
    where: 'Social accounts › Team access',
  },
  {
    icon: Bookmark,
    title: 'Presets & team drafts',
    body: 'Save named sets of accounts for the whole team. Drafts autosave, and a stale save is refused so two people never overwrite each other.',
    where: 'Create post',
  },
  {
    icon: ScrollText,
    title: 'Activity log',
    body: 'An audit trail of every team, settings, account and draft change: who did it and when.',
    where: 'Activity',
  },
];

export const STEPS = [
  {
    icon: Building2,
    title: 'Create a workspace',
    body: 'Sign up and name your first workspace: one per client, brand or creator you manage.',
  },
  {
    icon: Plug,
    title: 'Connect with Meta',
    body: 'Sign in with Facebook or Instagram on Meta’s own consent screen. Tokens are exchanged on the server and encrypted.',
  },
  {
    icon: Users,
    title: 'Choose accounts & invite your team',
    body: 'Pick which Pages and Instagram accounts to add, then give every teammate a role and only the accounts they need.',
  },
  {
    icon: SquarePen,
    title: 'Create, preview & check',
    body: 'Compose once, tailor per platform and check it against Meta’s documented limits, then publish now or schedule it. Every real post is previewed and confirmed first.',
  },
];

/** "Every page, explained": one entry per area of the app. */
export const TOUR = [
  {
    id: 'overview',
    icon: LayoutDashboard,
    label: 'Overview',
    path: '/w/your-workspace',
    title: 'Your workspace at a glance',
    body: 'The home of each workspace: team members, pending invitations, connected Facebook Pages and Instagram accounts, combined followers, a getting-started checklist and the latest activity.',
    points: [
      'Facebook, Instagram and combined follower totals',
      'Getting-started checklist for new workspaces',
      'Recent activity from your team',
      'Your own role and access, spelled out',
    ],
  },
  {
    id: 'accounts',
    icon: Share2,
    label: 'Social accounts',
    path: '/w/your-workspace/accounts',
    title: 'Every login, Page and profile in one place',
    body: 'Five tabs: Overview, Logins, Facebook Pages, Instagram and Team access, plus a detail page for every login and every account.',
    points: [
      '“Needs attention” list with the exact fix: reconnect or sync',
      'Search, filters, sorting and bulk actions on Pages and Instagram',
      'Publishing readiness checked against permissions and Page tasks',
      'Sync now, sync all, reconnect, disconnect or remove',
    ],
  },
  {
    id: 'compose',
    icon: SquarePen,
    label: 'Create post',
    path: '/w/your-workspace/compose',
    title: 'The universal post composer',
    body: 'Build a post once for many Facebook Pages and Instagram accounts, with previews and a readiness check against Meta’s documented limits.',
    points: [
      'Images and video with previews, reordering and alt text',
      'Shared caption or per-platform captions, hashtags and a first comment',
      'Internal SEO keywords that are stored but never published',
      'Account presets, autosave and team drafts',
    ],
    note: 'Publish now or schedule for later. Before a real post, SocialHub shows exactly what will be posted and where, and asks you to confirm it. A workspace can also run in simulation, which sends nothing to Meta.',
  },
  {
    id: 'team',
    icon: Users,
    label: 'Team',
    path: '/w/your-workspace/team',
    title: 'Invite people with exactly the right access',
    body: 'Invite teammates by email or a shareable link, choose their role and which social accounts they can use, and manage everyone in one list.',
    points: [
      'Owner, Admin, Editor and Viewer roles',
      'Invitations can grant accounts up front',
      'Pending invitations you can resend or revoke',
      'Members only manage people of a lower rank',
    ],
  },
  {
    id: 'activity',
    icon: Activity,
    label: 'Activity',
    path: '/w/your-workspace/activity',
    title: 'An audit trail you can trust',
    body: 'Owners and admins see every change made in the workspace: members, roles, connections, accounts, drafts, media and presets.',
    points: [
      'Written in the same database transaction as each change',
      'Post text is never copied into the log',
      'Restricted to owners and admins',
    ],
  },
  {
    id: 'settings',
    icon: Settings,
    label: 'Settings',
    path: '/w/your-workspace/settings',
    title: 'Workspace settings & ownership',
    body: 'Rename a workspace, change its URL and time zone, transfer ownership or delete it. Every dangerous action asks for your password.',
    points: [
      'Exactly one owner per workspace, guaranteed by the database',
      'Ownership moves only by transfer',
      'Deleting a workspace removes everything in it',
    ],
  },
  {
    id: 'account',
    icon: UserRound,
    label: 'Your account',
    path: '/account',
    title: 'Your profile and security',
    body: 'Your name, password and sessions, shared across every workspace you belong to.',
    points: [
      'Changing your password signs out every other device',
      'Sign out everywhere if a device is lost',
      'Password reset by email',
    ],
  },
];

export const COMPOSER_POINTS = [
  { icon: Eye, text: 'Facebook and Instagram previews, clearly labelled “Not published”' },
  {
    icon: ListChecks,
    text: 'Readiness checks against Meta’s documented limits, such as Instagram’s 2,200-character caption and 30 hashtags',
  },
  { icon: MessageCircle, text: 'Hashtags at the end of the caption or in the first comment' },
  {
    icon: BadgeCheck,
    text: 'Uploads are verified on the server (size, real file type, dimensions) before they count as ready',
  },
];

export const ROLE_COLUMNS = ['Owner', 'Admin', 'Editor', 'Viewer'];

/** From the RBAC matrix in packages/shared/src/roles.js. `true`, `false` or a short note. */
export const ROLE_ROWS = [
  { label: 'View workspace, members, accounts and content', cells: [true, true, true, true] },
  { label: 'Create drafts and use the composer', cells: [true, true, true, false] },
  { label: 'Invite members', cells: [true, 'Editors & viewers', false, false] },
  {
    label: 'Change roles and set account access',
    cells: [true, 'Editors & viewers', false, false],
  },
  { label: 'Connect, sync and disconnect Meta logins', cells: [true, true, false, false] },
  { label: 'View the activity log', cells: [true, true, false, false] },
  { label: 'Edit workspace settings', cells: [true, true, false, false] },
  { label: 'Transfer ownership or delete the workspace', cells: [true, false, false, false] },
];

export const SECURITY = [
  {
    icon: Plug,
    title: 'Official Meta APIs only',
    body: 'Facebook Login for Business and Instagram Login through the Graph API. No scraping, no password sharing, no browser automation.',
  },
  {
    icon: Lock,
    title: 'Encrypted, server-side tokens',
    body: 'Tokens are exchanged for long-lived ones on the server, stored AES-256-GCM encrypted and never returned to the browser or written to logs.',
  },
  {
    icon: Fingerprint,
    title: 'Hardened OAuth flow',
    body: 'A single-use 256-bit state that expires in 10 minutes, bound to your browser and workspace. Your role is checked again when Meta sends you back.',
  },
  {
    icon: KeyRound,
    title: 'Secure sessions',
    body: 'Short-lived access tokens in memory, a rotating httpOnly refresh cookie with reuse detection, rate limiting and timing-safe sign-in.',
  },
  {
    icon: ShieldCheck,
    title: 'Permissions enforced on the server',
    body: 'Every request checks your role and your account access. An account you may not use simply does not exist for you.',
  },
  {
    icon: FileLock2,
    title: 'Clean disconnects',
    body: 'Disconnecting erases the tokens. Meta’s deauthorize and data-deletion callbacks are verified with the app secret.',
  },
];

export const META_STEPS = [
  {
    title: 'Create a Meta developer app',
    body: 'Register as a Meta developer and create an app for your business.',
  },
  {
    title: 'Give it a public HTTPS address',
    body: 'Meta only redirects to HTTPS, so the API needs a real domain or a secure tunnel.',
  },
  {
    title: 'Turn on the login products',
    body: 'Facebook Login for Business for Pages, and/or Instagram Login for Instagram-only accounts.',
  },
  {
    title: 'Add your testers',
    body: 'In Development mode, only people with a role on the app can connect their own accounts.',
  },
  {
    title: 'Add the keys on the server',
    body: 'App IDs and secrets live only in the API’s environment file, never in the browser.',
  },
  {
    title: 'Go live',
    body: 'Business Verification and App Review unlock connecting accounts of people outside your app.',
  },
];

export const META_FACTS = [
  {
    title: 'Facebook tokens',
    body: 'Long-lived user tokens last about 60 days. Data access also lapses on the date Meta reports, and then the person reconnects.',
  },
  {
    title: 'Instagram tokens',
    body: 'Last 60 days and can be refreshed once they are at least 24 hours old. SocialHub’s daily sync refreshes them.',
  },
  {
    title: 'Professional accounts only',
    body: 'Meta supports Instagram Business and Creator accounts. Personal accounts must switch first.',
  },
  {
    title: 'Pick Pages at consent',
    body: 'People choose which Pages to share in Meta’s dialog. Pages left unselected are not visible to SocialHub.',
  },
];

/** Honest status of every area. Never mark something live that is not. */
export const ROADMAP = [
  {
    status: 'Ready',
    tone: 'mint',
    title: 'Teams & workspaces',
    items: [
      'Sign-up, sign-in and password reset',
      'Workspaces, invitations and roles',
      'Activity log and account settings',
    ],
  },
  {
    status: 'Verifying with Meta',
    tone: 'indigo',
    title: 'Facebook & Instagram accounts',
    items: [
      'Facebook Login and Instagram Login',
      'Account health, sync and history',
      'Least-privilege access and follower totals',
    ],
  },
  {
    status: 'Ready',
    tone: 'mint',
    title: 'Universal composer',
    items: [
      'Media, captions, hashtags and first comment',
      'Facebook and Instagram previews',
      'Team drafts, presets and verified uploads',
    ],
  },
  {
    // Verified with real Facebook Page posts on 2026-11-24; Instagram not yet verified.
    status: 'Ready for Facebook Pages',
    tone: 'mint',
    icon: CalendarClock,
    title: 'Publishing & scheduling',
    items: [
      'Publish now or schedule, with a preview and a confirmation before every real post',
      'Clear per-destination results with a link to the published post',
      'Instagram publishing built, not yet verified with a real account',
    ],
  },
  {
    // Phase 6 is a manual workflow: it needs no Meta API, so it is ready as built.
    status: 'Ready',
    tone: 'mint',
    title: 'Facebook Group sharing',
    items: [
      'A directory of groups with categories and tags',
      'Manual sharing tasks with completion tracking',
      'No automation or scraping',
    ],
  },
];

export const FAQ = [
  {
    q: 'Who is SocialHub for?',
    a: 'Creators, freelancers, in-house social teams and agencies that look after several Facebook Pages and Instagram accounts. Most agencies create one workspace per client.',
  },
  {
    q: 'Do my clients have to share their passwords?',
    a: 'No. Your client (or you, if you manage their Page) signs in on Meta’s own screen and chooses what to share. SocialHub receives an access token, encrypts it, and never sees a password.',
  },
  {
    q: 'Which accounts can I connect?',
    a: 'Facebook Pages the signed-in person can work on, the Instagram professional accounts linked to them, and Instagram Business or Creator accounts on their own through Instagram Login. Meta does not allow personal Instagram accounts or personal Facebook profiles in either flow.',
  },
  {
    q: 'Can SocialHub publish or schedule posts today?',
    a: 'Yes, to Facebook Pages: publish now or schedule for later. Before every real post SocialHub shows exactly what will be posted and where, and you confirm it. Instagram publishing is built but has not yet been verified with a real Instagram account. Until Meta approves SocialHub’s App Review, only Facebook accounts added to the Meta app can connect.',
  },
  {
    q: 'What happens when a connection expires?',
    a: 'The account is flagged as needing attention with the fix next to it, usually “Reconnect”. A daily sync re-checks every login and refreshes Instagram tokens before they lapse.',
  },
  {
    q: 'Can a teammate only see certain clients?',
    a: 'Yes. Editors and viewers start with no social accounts. Owners and admins assign accounts per member, per account or directly in the invitation, and the server enforces it on every request.',
  },
  {
    q: 'Can the same Page be connected through two people’s logins?',
    a: 'Yes. One login can manage many Pages and a Page can be reachable through several logins. SocialHub detects duplicates and never takes an account away from a healthy login.',
  },
  {
    q: 'What do I need to connect Meta?',
    a: 'A Meta developer app with Facebook Login for Business and/or Instagram Login, a public HTTPS address for the API, and the app keys on the server. In Development mode your own team can connect right away; connecting anyone else needs Meta’s App Review and Business Verification.',
  },
];
