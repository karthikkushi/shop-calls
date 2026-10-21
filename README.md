# Shop Calls (Fieldwork)

**What:** the phone calling app and owner dashboard for my Fieldwork shop pipeline: daily research finds shops and products to offer them, the caller works through the calls, and the owner tracks shops, suppliers and quotes.
**For:** my own small team (an owner and a caller). It is an internal tool, not a product.
**Run:** the apps are static pages served by GitHub Pages; the daily research is `cd worker && pip install -r requirements.txt && python -m backend.cloud_research_runner`, which needs the private codes and keys set in `.github/workflows/research.yml`.

Caller app: https://karthikkushi.github.io/shop-calls/caller/ · Owner dashboard: https://karthikkushi.github.io/shop-calls/dashboard/
Both need a private access code. No shop data or access codes are stored in this public repository.

## How it runs

- `caller/`: phone app for the caller. The HTTPS API needs a private caller code. Storage is separate from Lead Finder's.
- `dashboard/`: owner dashboard (needs a separate owner code). Shop management uses Supabase directly; other tools use
  saved cloud snapshots and an owner-only command bridge to the Mac worker.
- `worker/`: daily research. It runs on GitHub Actions, started by a Supabase timer at 09:00 IST, with scheduled
  backups; source data and job history stay in Supabase, so the Mac can be off for lead collection, product research,
  shop responses and bookings. Older draft/test tools and ad-hoc supplier searches still use the optional Mac bridge.

Tests: `cd worker && pip install pytest && python -m pytest backend`.

## Not done yet

- Tests cover only the cloud upload (`worker/backend/test_shop_cloud.py`).
- `dashboard/` holds built files only; its source is in the private repo `karthikkushi/fieldwork` (`frontend/`).
