import { History, RefreshCw, ShieldCheck, SquarePen, UserPlus, Users } from 'lucide-react';
import { Link } from 'react-router';
import { LEGAL_LINKS } from '../../pages/legal/legalLinks.js';
import { Logo } from '../ui/Brand.jsx';

const HIGHLIGHTS = [
  {
    icon: Users,
    title: 'Workspaces for every brand',
    body: 'Separate teams, accounts and permissions for each client or business.',
  },
  {
    icon: ShieldCheck,
    title: 'Roles with real boundaries',
    body: 'Owner, admin, editor and viewer roles plus per-member account access.',
  },
  {
    icon: History,
    title: 'A complete audit trail',
    body: 'Every invitation, role change and setting update is recorded.',
  },
];

/** Illustration only: the kind of events SocialHub shows, not real activity. */
const SAMPLE_EVENTS = [
  {
    icon: RefreshCw,
    tone: 'from-emerald-400 to-teal-500',
    title: 'Instagram token refreshed',
    detail: '@bloom.bakes · daily sync',
    className: 'left-0 top-0',
    delay: '0s',
  },
  {
    icon: SquarePen,
    tone: 'from-indigo-400 to-violet-500',
    title: 'Draft saved',
    detail: 'Autumn menu · version 4',
    className: 'right-0 top-[4.5rem]',
    delay: '-2.3s',
  },
  {
    icon: UserPlus,
    tone: 'from-amber-400 to-pink-500',
    title: 'Priya joined as Editor',
    detail: 'Access: 2 accounts',
    className: 'left-6 top-[9rem]',
    delay: '-4.6s',
  },
];

function SampleActivity() {
  return (
    <div className="relative h-[13.5rem] max-w-sm" aria-hidden="true">
      {SAMPLE_EVENTS.map(({ icon: Icon, tone, title, detail, className, delay }, i) => (
        <div
          key={title}
          className={`absolute ${className} animate-rise`}
          style={{ animationDelay: `${500 + i * 160}ms` }}
        >
          <div
            className="flex animate-float items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.07] py-2.5 pr-4 pl-2.5 shadow-[0_20px_40px_-20px_rgb(0_0_0/0.8)] ring-1 ring-white/5 backdrop-blur-xl"
            style={{ animationDelay: delay }}
          >
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br ${tone} text-white shadow-lg`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-[13px] font-medium text-white">{title}</span>
              <span className="block text-[11px] text-white/55">{detail}</span>
            </span>
          </div>
        </div>
      ))}
      <p className="absolute right-2 bottom-0 text-[10px] tracking-[0.14em] text-white/35 uppercase">
        Sample activity
      </p>
    </div>
  );
}

export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen">
      <aside className="relative isolate hidden w-[46%] max-w-2xl overflow-hidden bg-[#08070f] lg:flex lg:flex-col">
        <div
          className="absolute -top-40 -left-40 -z-10 h-[30rem] w-[30rem] animate-drift rounded-full bg-indigo-600/45 blur-[110px]"
          aria-hidden="true"
        />
        <div
          className="absolute -right-32 -bottom-48 -z-10 h-[28rem] w-[28rem] animate-drift rounded-full bg-fuchsia-600/35 blur-[110px] [animation-delay:-9s]"
          aria-hidden="true"
        />
        <div
          className="absolute top-1/3 right-1/4 -z-10 h-64 w-64 animate-drift rounded-full bg-orange-500/15 blur-[100px] [animation-delay:-15s]"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgb(255_255_255/.045)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/.045)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_80%_70%_at_30%_40%,#000_30%,transparent_80%)] bg-[size:44px_44px]"
          aria-hidden="true"
        />
        <div className="relative flex flex-1 flex-col justify-between p-10 xl:p-14">
          <Link to="/" aria-label="SocialHub home" className="w-fit animate-fade-in">
            <Logo light />
          </Link>
          <div>
            <h2 className="max-w-md animate-rise text-[2.1rem] leading-[1.12] font-semibold tracking-[-0.03em] text-white xl:text-[2.5rem]">
              One home for your team&apos;s{' '}
              <span className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-orange-200 bg-clip-text text-transparent">
                social presence.
              </span>
            </h2>
            <ul className="mt-10 space-y-6">
              {HIGHLIGHTS.map(({ icon: Icon, title: t, body }, i) => (
                <li
                  key={t}
                  className="flex animate-rise gap-4"
                  style={{ animationDelay: `${150 + i * 90}ms` }}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white/15 to-white/5 text-white ring-1 ring-white/15 backdrop-blur ring-inset">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-medium text-white">{t}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-white/60">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-12">
              <SampleActivity />
            </div>
          </div>
          <p className="text-xs text-white/40">© {new Date().getFullYear()} SocialHub</p>
        </div>
      </aside>

      <main className="relative isolate flex flex-1 items-center justify-center overflow-hidden px-5 py-12 sm:px-8">
        <div
          className="absolute -top-48 right-[-10%] -z-10 h-[26rem] w-[34rem] animate-drift rounded-full bg-brand-400/15 blur-[110px] dark:bg-brand-500/20"
          aria-hidden="true"
        />
        <div
          className="absolute bottom-[-12rem] left-[-8%] -z-10 h-[22rem] w-[26rem] animate-drift rounded-full bg-fuchsia-400/10 blur-[110px] [animation-delay:-11s] dark:bg-fuchsia-500/10"
          aria-hidden="true"
        />
        <div className="w-full max-w-sm">
          <Link
            to="/"
            className="mb-10 inline-flex animate-fade-in lg:hidden"
            aria-label="SocialHub home"
          >
            <Logo />
          </Link>
          <h1 className="animate-rise text-[1.75rem] font-semibold tracking-[-0.025em] text-slate-900 dark:text-white">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 animate-rise text-sm text-muted [animation-delay:60ms]">
              {subtitle}
            </p>
          )}
          <div className="auth-form mt-8">{children}</div>
          {footer && (
            <div className="mt-8 animate-fade-in text-center text-sm text-muted [animation-delay:400ms] [animation-fill-mode:backwards]">
              {footer}
            </div>
          )}
          <nav
            aria-label="Legal"
            className="mt-10 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted"
          >
            {/* Static pages outside the SPA: plain links load them from the server. */}
            {LEGAL_LINKS.map(({ path, title }) => (
              <a
                key={path}
                href={path}
                className="transition-colors hover:text-slate-900 dark:hover:text-white"
              >
                {title}
              </a>
            ))}
          </nav>
        </div>
      </main>
    </div>
  );
}
