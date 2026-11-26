import { useEffect, useEffectEvent, useRef, useState } from 'react';

const hasObserver = () => typeof window !== 'undefined' && 'IntersectionObserver' in window;
const clamp = (value, min = -1, max = 1) => Math.min(max, Math.max(min, value));
const finePointer = () => Boolean(window.matchMedia?.('(pointer: fine)').matches);

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  );
}

/** Tracks `prefers-reduced-motion`, updating if the user changes it while the page is open. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media?.addEventListener) return undefined;
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * True once the element has scrolled into view (and stays true). Without IntersectionObserver
 * (old browsers, jsdom) it is true immediately, so content is never left hidden.
 */
export function useInView({ threshold = 0.15, rootMargin = '0px 0px -8% 0px' } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(() => !hasObserver());

  useEffect(() => {
    const node = ref.current;
    if (inView || !node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, threshold, rootMargin]);

  return [ref, inView];
}

/**
 * Calls `onProgress(0…1)` as the element scrolls past the upper part of the viewport: 0 while
 * its top is below 72% of the viewport height, 1 once its bottom has passed that line.
 * Frame-throttled; the callback may write styles directly.
 */
export function useScrollProgress(ref, onProgress) {
  const report = useEffectEvent(onProgress);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const line = (window.innerHeight || 1) * 0.72;
      report(rect.height > 0 ? clamp((line - rect.top) / rect.height, 0, 1) : 1);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [ref]);
}

/**
 * Whether the element is on screen right now. Unlike useInView it turns false again, so a
 * timer can stop while nobody is looking. True without IntersectionObserver.
 */
export function useOnScreen(ref) {
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const node = ref.current;
    if (!node || !hasObserver()) return undefined;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return onScreen;
}

/**
 * Marks each child of `rootRef` with `data-offscreen` while it is outside the viewport (plus a
 * small margin). landing.css pauses the animations of a marked section, so loops do not run
 * where nobody can see them. Written to the DOM: no re-render.
 */
export function usePauseOffscreen(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !hasObserver()) return undefined;
    const sections = [...root.children];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          entry.target.toggleAttribute('data-offscreen', !entry.isIntersecting);
        }
      },
      { rootMargin: '12% 0px 12% 0px' },
    );
    for (const section of sections) observer.observe(section);
    return () => {
      observer.disconnect();
      for (const section of sections) section.removeAttribute('data-offscreen');
    };
  }, [rootRef]);
}

/**
 * Pointer parallax: while the pointer moves over `areaRef`, writes its position (-1…1 from
 * the centre of the area) to `--px`/`--py` on `stageRef` and on the area itself. Mouse and pen
 * only, never under reduced motion. CSS turns the values into tilt and depth (see
 * `.lp-parallax`, `.lp-depth` and `.lp-social-depth`).
 */
export function usePointerParallax(areaRef, stageRef) {
  const reduced = useReducedMotion();

  useEffect(() => {
    const area = areaRef.current;
    const stage = stageRef.current;
    if (!area || !stage || reduced || !finePointer()) return undefined;
    let frame = 0;
    let x = 0;
    let y = 0;
    const write = () => {
      frame = 0;
      // The stage declares its own defaults, so the hero section needs the values as well.
      for (const node of [stage, area]) {
        node.style.setProperty('--px', x.toFixed(3));
        node.style.setProperty('--py', y.toFixed(3));
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(write);
    };
    const onMove = (event) => {
      const rect = area.getBoundingClientRect();
      x = clamp((event.clientX - rect.left - rect.width / 2) / (rect.width / 2 || 1));
      y = clamp((event.clientY - rect.top - rect.height / 2) / (rect.height / 2 || 1));
      schedule();
    };
    const onLeave = () => {
      x = 0;
      y = 0;
      schedule();
    };
    area.addEventListener('pointermove', onMove, { passive: true });
    area.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      area.removeEventListener('pointermove', onMove);
      area.removeEventListener('pointerleave', onLeave);
    };
  }, [areaRef, stageRef, reduced]);
}

/** Returns a ref whose element leans towards the pointer while hovered (`.lp-magnetic`). */
export function useMagnetic(strength = 0.25) {
  const ref = useRef(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced || !finePointer()) return undefined;
    const onMove = (event) => {
      const rect = node.getBoundingClientRect();
      const x = (event.clientX - rect.left - rect.width / 2) * strength;
      const y = (event.clientY - rect.top - rect.height / 2) * strength;
      node.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
    };
    const onLeave = () => {
      node.style.translate = '';
    };
    node.addEventListener('pointermove', onMove, { passive: true });
    node.addEventListener('pointerleave', onLeave);
    return () => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', onLeave);
    };
  }, [reduced, strength]);

  return ref;
}

/**
 * The id of the section (from `ids`, in page order) crossing a thin band just above the middle
 * of the viewport, or null between sections. Always null without IntersectionObserver.
 */
export function useActiveSection(ids) {
  const [active, setActive] = useState(null);

  useEffect(() => {
    if (!hasObserver()) return undefined;
    const crossing = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) crossing.set(entry.target.id, entry.isIntersecting);
        setActive(ids.find((id) => crossing.get(id)) ?? null);
      },
      { rootMargin: '-38% 0px -58% 0px' },
    );
    for (const id of ids) {
      const node = document.getElementById(id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

const HEX = '0123456789abcdef';
const randomHex = () => HEX[Math.floor(Math.random() * HEX.length)];

/**
 * A hex string of `seed`'s length whose characters keep changing while `active`, like
 * ciphertext being re-encrypted. Static (the seed) when inactive.
 */
export function useScramble(seed, active) {
  const [text, setText] = useState(seed);

  useEffect(() => {
    if (!active) return undefined;
    let current = seed;
    const id = setInterval(() => {
      const chars = current.split('');
      for (let n = 0; n < 4; n += 1) {
        const at = Math.floor(Math.random() * chars.length);
        if (chars[at] !== '·') chars[at] = randomHex();
      }
      current = chars.join('');
      setText(current);
    }, 90);
    return () => clearInterval(id);
  }, [seed, active]);

  return text;
}
