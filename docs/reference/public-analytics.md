# Public Analytics Runbook

This runbook covers privacy-safe public analytics for `openjobslots.com`.

## What Is Tracked

- Backend first-party search/report data comes from Postgres `public_search_events`.
- Google Analytics is optional and only loads when `OPENJOBSLOTS_GA_MEASUREMENT_ID` is set.
- Search Console verification is optional and only injects a meta tag when `OPENJOBSLOTS_GSC_VERIFICATION_TOKEN` is set.
- Frontend GA events are aggregate-only:
  - `search` with sanitized `search_term` and `search_source`.
  - `openjobslots_filter_changed` with `filter_type`.
  - `openjobslots_apply_click` with `ats`.

Do not send IPs, emails, phone numbers, full posting URLs, raw user agents, or applicant data to Google Analytics.

## Environment

```bash
OPENJOBSLOTS_GA_MEASUREMENT_ID=G-XXXXXXXXXX
OPENJOBSLOTS_GSC_VERIFICATION_TOKEN=google-site-verification-token

OPENJOBSLOTS_ANALYTICS_EMAIL_TO=maintainer@example.com
OPENJOBSLOTS_ANALYTICS_EMAIL_FROM=reports@openjobslots.com
OPENJOBSLOTS_SMTP_HOST=smtp.example.com
OPENJOBSLOTS_SMTP_PORT=465
OPENJOBSLOTS_SMTP_SECURE=1
OPENJOBSLOTS_SMTP_USER=reports@openjobslots.com
OPENJOBSLOTS_SMTP_PASS=...
```

`OPENJOBSLOTS_ANALYTICS_EMAIL_TO` defaults to `maintainer@example.com`.

## Commands

Print the existing backend daily report:

```bash
npm run analytics:daily -- --date=today
```

Print the email body without sending:

```bash
npm run analytics:daily:email -- --date=today --dry-run
```

Generate a deterministic example report without database or SMTP access:

```bash
npm run analytics:daily:email -- --sample --dry-run
```

Send the daily email after SMTP env is configured:

```bash
npm run analytics:daily:email -- --date=today
```

## Daily Production Schedule

Run near the end of the Istanbul day so `--date=today` covers the intended reporting window. Example systemd timer:

```ini
[Timer]
OnCalendar=*-*-* 23:55:00 Europe/Istanbul
Persistent=true
```

The service command should run in the production checkout/container with the SMTP env above:

```bash
npm run analytics:daily:email -- --date=today
```

This report is read-only. It does not backfill, reindex, mutate sources, or touch worker throughput.
