# Website readiness review

Local verification: 2026-09-10. These changes have not been deployed.

| Checklist item | Result |
| --- | --- |
| 1. Custom domain | Pending domain selection and DNS configuration. Metadata currently uses the existing booundless.vercel.app origin. |
| 2. Empty view source | Not applicable: the app ships HTML content, not an empty React mount. Account data and interactivity still require JavaScript. |
| 3. 404 | Added 404.html and local HTTP 404 handling, plus a hash-route error screen. Verified local HTTP status 404. Production behavior needs deployment verification. |
| 4. Framework/template traces | No Vite/React runtime. Replaced the template browser title and topbar identity with BOOUNDLESS. Existing 康程 product copy remains. |
| 5. Page titles | Added titles for all current routes and unknown routes. Verified home and garage in browser. |
| 6. Description | Added source-HTML description. |
| 7. Social image | Added OG/Twitter metadata and supplied square brand image. Local image fetch passed; actual social previews need deployment. |
| 8. Structured data | Added factual WebSite JSON-LD; parsing passed. No invented reviews, ratings or business address. |
| 9–10. H1 | Home has one visible H1. Other screens are hidden within the same static document; raw source still contains their headings. Added H1 to the error screen. |
| 11. Canonical | One non-fragment canonical for the public app document. Hash screens are not independent search landing pages. |
| 12. llms.txt | Added public product description. This is descriptive guidance, not a guarantee of crawler support or ranking. |
| 13. Robots | Public pages allowed for all agents, including AI crawlers; API/internal paths disallowed. Robots is not access control. |
| 14. Favicon | Linked supplied car icon, also used in topbar. Verified asset HTTP 200. |
| 15. Sitemap | Added only the public document URL. Private account/admin hash views deliberately omitted. |
| 16. Language | Existing zh-Hant retained and verified. |
| 17. Alt text | Added vehicle photo descriptions where missing; decorative brand image uses empty alt inside a labelled link. Home DOM has no img without alt. |
| 18. Source maps | Added deployment exclusion for .map files. The project has no bundler-generated production maps. Public HTML/JavaScript remains readable by design. |
| 19. Console errors | Removed dispatch debug logging. No warning/error logs observed in the tested home/garage session; authenticated and all-route coverage remains pending. |

## Remaining decisions

- Select the official domain, connect it in Vercel/DNS, then update canonical, OG URLs, JSON-LD, sitemap, robots and llms links together.
- If separate searchable service pages are wanted, build public pages at normal path URLs with useful source HTML and page-specific metadata. Do not use hash URLs in the sitemap. Google guidance: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- Deploy and verify public 404 status, crawler files, icon and social previews.
- Authenticated provider creation and AI tool execution from the earlier testing task still require admin sign-in.
