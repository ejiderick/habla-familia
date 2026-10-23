# FamilySpeak website

Served by GitHub Pages at https://familyspeak.app (custom domain).

| Path | What |
| --- | --- |
| `/` | Home page. Old family links (`/#t=…`) forward to `/familia/`. |
| `/privacy/`, `/terms/`, `/support/` | Privacy Policy, Terms, Support |
| `/familia/` | The family voice recording page opened from the secret link a parent shares in the app. It holds no secrets: each link's token is checked by the FamilySpeak server. |
| `/assets/` | Styles, icons and fonts (hosted here, not by Google) |

Source of truth: `web/site/` and `web/familia/` in the private habla-app repo.
Publish with `node scripts/publish-site.mjs <path to this clone>`, then commit and push here.
