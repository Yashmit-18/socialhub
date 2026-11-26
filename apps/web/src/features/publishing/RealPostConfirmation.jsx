/**
 * The explicit "this is a real public post" confirmation shown before a REAL post is created,
 * in the composer's Publish dialog and in "Publish a draft". Ticking it is what makes the
 * request carry `confirmRealPost: true`; the API refuses a real post without that, so this
 * checkbox is the person's decision, not the only safeguard.
 */
export function RealPostConfirmation({
  accountNames,
  scheduled,
  checked,
  disabled,
  onChange,
  postCount = 1,
}) {
  const several = postCount > 1;
  return (
    <div className="rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-3 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
      <p className="font-semibold">
        {several
          ? `This creates ${postCount} REAL public posts.`
          : 'This creates a REAL public post.'}
      </p>
      <p className="mt-0.5">
        {several ? 'Each video is published as its own post' : 'It is published'} on{' '}
        {accountNames.join(', ')}
        {scheduled ? ' at the time chosen above' : ' as soon as you confirm'}, and people can see{' '}
        {several ? 'them' : 'it'} there. SocialHub cannot delete {several ? 'them' : 'it'} for you
        afterwards.
      </p>
      <label className="mt-2.5 flex items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-rose-300 text-rose-600 focus:ring-rose-500"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          I understand that this publishes {several ? `${postCount} real posts` : 'a real post'} on
          these accounts.
        </span>
      </label>
    </div>
  );
}
