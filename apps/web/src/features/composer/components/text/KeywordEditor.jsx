import { EyeOff, Lock } from 'lucide-react';
import { Badge } from '../../../../components/ui/Badge.jsx';
import { cn } from '../../../../lib/utils.js';
import { composerActions } from '../../model/composerState.js';
import { TEXT_LIMITS, parseKeywordInput } from '../../model/text.js';
import { TagInput } from './TagInput.jsx';

/** Keywords are phrases, so a space does not commit — only Enter and comma do. */
const COMMIT_KEYS = ['Enter', ','];

function parseKeywords(text) {
  const { keywords, errors } = parseKeywordInput(text);
  return { values: keywords, errors };
}

/**
 * Internal SEO keywords: kept with the post in SocialHub, never published. They are not part of
 * any caption or first comment (`platformOutput` ignores them).
 *
 * Props: state, dispatch, id, className.
 */
export function KeywordEditor({ state, dispatch, id, className }) {
  return (
    <div id={id} className={cn(className)}>
      <TagInput
        label="SEO keywords"
        badge={
          <Badge tone="neutral">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Internal only
          </Badge>
        }
        description={
          <p className="flex items-start gap-1.5">
            <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <span>
              Keywords are for your team&rsquo;s own reference and are saved with this draft. They
              are never added to captions or sent to Facebook or Instagram.
            </span>
          </p>
        }
        values={state.keywords}
        onAdd={(keywords) => dispatch(composerActions.addKeywords(keywords))}
        onRemove={(keyword) => dispatch(composerActions.removeKeyword(keyword))}
        parse={parseKeywords}
        commitKeys={COMMIT_KEYS}
        placeholder={
          state.keywords.length ? 'Add another keyword' : 'e.g. summer sale, trail shoes'
        }
        max={TEXT_LIMITS.KEYWORDS_MAX}
        noun="keywords"
        chipTone="neutral"
        hint="Press Enter or type a comma after each keyword. Phrases can include spaces."
      />
    </div>
  );
}
