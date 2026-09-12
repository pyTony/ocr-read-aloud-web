# TODO — page-offset/real-page linking + non-interrupting ad handling

Scope: `player.py`, `continue_links.py`, `ad_pages.py`, `cli.py` (the four files
these two features actually touch). Based on reading the current uploaded code,
not the old chat transcript — this is new ground the transcript never covered.

Confirmed working already, don't touch: `_vision_hint_for_page` (cli.py), the
preview highlight bar (`_refresh_preview` → `preview.show_region`), `--regenerate-cache`.

---

## PRIORITY 1 — Page-offset not applied to manual "Go to page" (goto_page)

**Why this is priority 1:** you called linking/continuing articles to real page
numbers "the most obvious usability feature," and the offset machinery already
exists and is wired into the *automatic* continued-on/from jump path — but not
into the *manual* one, which is the one a person actually types into an input
box. Right now typing a real printed page number can land on the wrong page
whenever `folio_of()` can't read the footer number directly.

**Evidence:**
- `player.py` `PlaybackController.__init__` already stores `self._page_offset`
  (line ~199) and it's correctly threaded through:
  - `position_label()` (line ~299): `printed = int(m.group(1)) - self._page_offset`
  - `_jump_to_continue()` / `_try_pending_continue()` (lines ~1181, ~1225): both
    pass `offset=self._page_offset` into `find_continue_landing(...)`.
- But `_find_page_target()` (line ~999) — the function `goto_page()` calls —
  **never references `self._page_offset` at all**:
  ```python
  @staticmethod
  def _find_page_target(
      pages: Sequence[PageUnit], number: int, *, allow_heuristic: bool = True
  ) -> int | None:
      for i, page in enumerate(pages):
          if folio_of(page) == number:
              return i
      if allow_heuristic:
          for i, page in enumerate(pages):
              try:
                  if _looks_like_target_folio(page, number):
                      return i
              except Exception:
                  continue
      if number <= len(pages):
          return number - 1          # <-- treats `number` as a raw PDF index, ignores offset
      return None
  ```
  It's a `@staticmethod`, so it doesn't even have access to `self._page_offset`
  — that's the structural reason it was never wired in.
- `continue_links.py`'s `_looks_like_target_folio(page, target_folio)` also takes
  no offset parameter, so the heuristic step above has the same gap.
- Compare with `find_continue_landing()` in the same file, which already has the
  right pattern to copy (Priority 1: exact folio match; **Priority 2: try
  `target_folio + offset` as a PDF index** — this is exactly the step missing
  from `_find_page_target`).

**Fix:**
1. Change `_find_page_target` from `@staticmethod` to a normal instance method
   (or pass `offset: int` in explicitly — instance method is simplest since
   `goto_page` is the only caller and already has `self`).
2. After the existing exact-folio loop and before the heuristic loop, add an
   offset-adjusted index guess, mirroring `find_continue_landing`'s Priority 2:
   ```python
   if self._page_offset:
       candidate = number + self._page_offset - 1  # 0-based PDF index guess
       if 0 <= candidate < len(pages) and folio_of(pages[candidate]) in (None, number):
           return candidate
   ```
   (Guard with `folio_of(...) in (None, number)` so this doesn't override a page
   whose OCR'd folio clearly disagrees.)
3. Pass `self._page_offset` into `_looks_like_target_folio` too (add the
   parameter in `continue_links.py`, default `0` for backward compatibility with
   any other callers), and inside it, also test
   `label_n == target_folio + offset` alongside the existing
   `label_n == target_folio`.
4. Only fall back to the raw `number - 1` index guess (current last line) when
   `self._page_offset == 0` — with a nonzero offset known, a raw index guess is
   more likely wrong than useful; prefer returning `None` (so the UI reports
   "page not found") over silently landing on the wrong page.

**Test:** once `compute_folio_offset` has locked in a nonzero offset for a
document (front-matter/cover pages before printed page 1 starts), type the
printed page number for an article you know the real page of and confirm
`goto_page` lands there — not `offset` pages off.

---

## PRIORITY 2 — `compute_folio_offset` caching is too eager / not re-verified

**Why this matters:** it's the single source of truth Priority 1 depends on —
if the offset it computes is wrong, fixing `_find_page_target` won't help.

**Evidence (`continue_links.py`):**
```python
_FOLIO_OFFSET_CACHE = None
def compute_folio_offset(pages) -> int:
    global _FOLIO_OFFSET_CACHE
    if _FOLIO_OFFSET_CACHE is not None:
        return _FOLIO_OFFSET_CACHE
    for page in pages:
        ...
        if candidate_folios:
            folio = candidate_folios[-1]
            offset = pdf_idx - folio
            if -10 <= offset <= 10:
                _FOLIO_OFFSET_CACHE = offset
                ...
                return offset
    return 0
```
It's called from two places in `cli.py` with different page sets:
- **Pre-scan** (line ~581): `compute_folio_offset(temp_pages)` where
  `temp_pages` is **just the first loaded page**. If that single page's footer
  OCR (or the bottom-10%-crop Tesseract fallback) misreads a number — very
  plausible on a noisy scan, cover, or ad page with a stray digit — the module
  level `_FOLIO_OFFSET_CACHE` is set **once, globally, for the rest of the
  process**, and the second call site below just returns that same (possibly
  wrong) cached value instead of re-verifying against more evidence.
- **Loader loop** (line ~648): `compute_folio_offset(pages)` called again as
  each page streams in, intending to "compute offset exactly once when enough
  pages are present" — but because of the module-level cache, this can never
  actually reconsider once the pre-scan has already set a value from a single
  (possibly bad) page.

**Fix options (pick one, simplest first):**
- **A. Don't cache across the two call sites.** Make `compute_folio_offset`
  take an explicit `min_pages: int = 3` and only consider/commit an offset once
  at least that many pages have candidate folios *agreeing* with each other
  (e.g. majority vote across 3+ pages, not first-hit). Drop the module-level
  global entirely — have the caller (`cli.py`) hold the offset in its own local
  `global_offset` variable (which it already does) and pass it back in, rather
  than relying on the function to remember it.
- **B. Keep the cache but require agreement.** Only write to
  `_FOLIO_OFFSET_CACHE` once the same offset has been seen from 2 different
  pages, so a single misread page can't lock in a bad global offset for the
  whole session.
- Either way: log (`print(...)`) when the offset is accepted with which
  page(s)/folio(s) it was derived from, so a bad detection is diagnosable from
  the terminal output instead of silently mis-linking every "go to page" /
  continue-jump for the rest of the run.

---

## PRIORITY 3 — Non-interrupting / multi-page ad runs not handled

**Your framing:** "not considering non-article interrupting ads is still on
todo, not done yet." Two distinct gaps map to that sentence — implement both,
they're independent:

### 3a. Consecutive multi-page ad blocks are only skipped one page at a time (and the 2nd+ ad page gets read aloud first)

**Evidence (`ad_pages.py` `find_ad_skip`):** hardcoded to a single ad page
between source and continuation:
```python
if current_idx < 0 or current_idx + 2 >= len(pages):
    return None
ad_idx = current_idx + 1
cont_idx = current_idx + 2
```
So a real-world `F (article), F+1 (ad), F+2 (ad), F+3 (continued article)` run
is never matched — `cont_page` at `current_idx + 2` is itself still an ad, so
`continues` stays `False` and `find_ad_skip` returns `None`.

**What happens today:** `player.py`'s `_try_ad_skip_from` (line ~1520) has a
"safety net" fallback that skips exactly one page forward when the *current*
landing page looks like an ad — but it only fires once per page-boundary
transition. So on a 2-page ad run: page F+1 gets skipped by the safety net,
landing on F+2 — but F+2 is *also* an ad, and nothing re-checks it immediately;
the player starts reading F+2's (ad) content aloud, and only on the *next*
natural page-turn does `_try_ad_skip_from` get another chance to notice F+2 was
an ad too (by which time it's already been spoken).

**Fix:** in `_try_ad_skip_from`, after computing a skip target (from either
`find_ad_skip` or the safety net), loop while the new landing page still looks
like an ad, consuming the whole run before returning:
```python
def _try_ad_skip_from(self, left_page_idx: int) -> tuple[int, int] | None:
    if not self._skip_ad_pages:
        return None
    with self._lock:
        pages = list(self._pages)
        if left_page_idx < 0 or left_page_idx >= len(pages):
            return None
        source = folio_of(pages[left_page_idx])
        skip = find_ad_skip(pages, left_page_idx, source_folio=source)
        if skip is not None:
            ad_idx, cont_idx, cont_line = skip
        else:
            cur = self._page_idx
            if cur < 0 or cur >= len(pages) or cur + 1 >= len(pages):
                return None
            land = pages[cur]
            on_ad = (
                bool(getattr(land, "skip_as_ad", False))
                or cur in self._ad_queue
                or cur in self._skipped_ads
                or looks_like_ad(land)
                or looks_like_form_ad(land)
            )
            if not on_ad:
                return None
            ad_idx, cont_idx, cont_line = cur, cur + 1, 0

        # NEW: consume a run of consecutive ad-like pages, not just one.
        skipped_run = [ad_idx]
        while cont_idx < len(pages) and cont_line == 0:
            candidate = pages[cont_idx]
            still_ad = (
                bool(getattr(candidate, "skip_as_ad", False))
                or looks_like_ad(candidate)
                or looks_like_form_ad(candidate)
            )
            if not still_ad:
                break
            skipped_run.append(cont_idx)
            cont_idx += 1
        self._page_idx = cont_idx
        self._line_idx = max(0, cont_line)
        self._sent_idx = 0
    for idx in skipped_run:
        self._enqueue_ad(idx)
    self._notify_ad_skipped(skipped_run[-1], cont_idx)
    return (cont_idx, cont_line)
```
(Sketch — check locking carefully: the `while` loop reads `pages`/`cont_line`
which were captured before the lock in some branches; keep everything that
reads `self._pages` inside the existing `with self._lock:` block as shown.)

### 3b. Standalone (non-interrupting) ads aren't classified/tracked at all

Per your originally stated preference (earlier session): standalone full-page
ads that don't interrupt an article's continuation should still be **read
normally** (not skipped) — they're "commercial articles." That part is already
correct by omission: `find_ad_skip` requires `linked_to_source`, so a standalone
ad is simply never touched and gets read like any other page. Nothing to fix
there.

The actual gap: standalone ads never get added to `self._ad_queue` /
`self._skipped_ads` (both are only populated via `_enqueue_ad`, only called
from inside `_try_ad_skip_from`, only reached when a *skip* happens). So:
- The "Ad" jump button / `ad_queue()` / `jump_ad()` UI in `player.py` has no way
  to show or jump to a standalone ad page — the user can't easily find "where
  were the ads in this issue" the way they can for skipped ones.
- `is_viewing_ad()` (checks `self._page_idx in self._skipped_ads`) returns
  `False` even while sitting on a page that `looks_like_ad()` would call an ad,
  since it was never skipped, so nothing marked it.

**Fix (needs a product decision — flag for Tony/Deepseek/Gemini before
implementing):** during normal forward playback (not just ad-skip events), when
landing on a page where `looks_like_ad(page) or looks_like_form_ad(page)` is
true and it was *not* reached via a skip, still call `self._enqueue_ad(idx)` so
it shows up in `ad_queue()` for navigation — but do **not** advance past it or
mark it `skipped_ads` (keep `_skipped_ads` meaning "silently jumped over," add
a separate `self._seen_ads: list[int]` or reuse `_ad_queue` for "known ad pages
regardless of skip status" vs. `_skipped_ads` for "actually skipped ones," and
update `is_viewing_ad()`/`ad_button_mode()` to reflect the distinction if the UI
cares). The simplest version: just call `self._enqueue_ad(idx)` (which already
appends to both lists) at the point in `run()` where a new page starts being
read, guarded by `looks_like_ad(page) and idx not in self._skipped_ads` — but
that reuses `_skipped_ads` for "seen," which will make `is_viewing_ad()` lie
(it'll say True even though the page is being read, not skipped). Recommend
splitting into two lists rather than overloading `_skipped_ads`.

---

## Suggested order of work for whoever picks this up next
1. Priority 1 (§`_find_page_target` offset fix) — small, isolated, in
   `player.py` + one parameter added to `continue_links.py`.
2. Priority 2 (§`compute_folio_offset` re-verification) — also isolated, in
   `continue_links.py` + minor `cli.py` call-site cleanup. Do this alongside
   #1 since #1's correctness depends on it.
3. Priority 3a (multi-page ad run skip) — isolated to `_try_ad_skip_from` in
   `player.py`, no data-model changes needed.
4. Priority 3b (standalone ad tracking) — needs the product decision flagged
   above before writing code; do last.
