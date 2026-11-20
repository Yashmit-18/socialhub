import { History, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router';
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

export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen">
      <aside className="relative hidden w-[44%] max-w-xl overflow-hidden bg-slate-950 lg:flex lg:flex-col">
        <div
          className="absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-brand-600/50 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="absolute -bottom-48 -right-32 h-[26rem] w-[26rem] rounded-full bg-fuchsia-600/30 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/.04)_1px,transparent_1px)] bg-[size:44px_44px]"
          aria-hidden="true"
        />
        <div className="relative flex flex-1 flex-col justify-between p-10 xl:p-12">
          <Link to="/" aria-label="SocialHub home">
            <Logo light />
          </Link>
          <div>
            <h2 className="max-w-sm text-3xl font-semibold leading-tight tracking-tight text-white">
              One home for your team&apos;s social presence.
            </h2>
            <ul className="mt-10 space-y-6">
              {HIGHLIGHTS.map(({ icon: Icon, title: t, body }) => (
                <li key={t} className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/15 backdrop-blur">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-medium text-white">{t}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-white/60">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-white/40">© {new Date().getFullYear()} SocialHub</p>
        </div>
      </aside>

      <main className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-10 inline-flex lg:hidden" aria-label="SocialHub home">
            <Logo />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {title}
          </h1>
          {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-center text-sm text-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
