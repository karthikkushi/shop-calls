# Shop Calls
Separate phone calling app for the Fieldwork shop pipeline. No shop data or access codes are stored in this public repository. The HTTPS API requires a private caller code. Storage is separate from Leadfinder's tables. Daily research currently runs on the owner's Mac.

Owner dashboard: https://karthikkushi.github.io/shop-calls/dashboard/

The owner dashboard requires a separate private owner code. Shop management uses Supabase directly. Other tools use saved cloud snapshots and an owner-only command bridge to the Mac worker. The Mac is required for research, supplier searches and local draft/test actions. No owner or caller codes are published here.

Daily research now runs on GitHub Actions, started by a Supabase timer at 09:00 IST with scheduled backups. Source data and job history persist in Supabase. The Mac can be off for daily lead collection, product research, shop responses and bookings. Older draft/test tools and ad-hoc supplier searches still use the optional Mac bridge.
