# Rack Relic search discovery

## Scope

Rack Relic is a fashion resale marketplace preview at https://www.rackrelic.com/. Its public homepage currently describes fashion, sneakers and streetwear, favorites and listing preparation. Do not imply checkout, payments or buyer protection are live until launch acceptance verifies them. Keep this work separate from Clear Choice Payments.

## Crawl foundation

- Serve robots.txt as text/plain and sitemap.xml as application/xml (text/xml is also acceptable), both with HTTP 200 at the canonical www host.
- The sitemap deliberately includes only the public homepage. Expand it only with verified, substantive public pages using their canonical URLs. Never add demo inventory, private accounts, messages, reports or drafts.
- robots.txt allows general search crawlers, including OAI-SearchBot, under the wildcard rule. It excludes demo/listing routes pending launch and personal/API workflows. Robots directives are not access controls; preserve authorization and privacy enforcement.
- Verify hosting/firewall access separately for Googlebot, Bingbot and OAI-SearchBot. A robots file alone cannot prove crawler access.
- No training-crawler preference is changed by this patch; it documents public discovery only.

## Next implementation

1. Add canonical, Open Graph and Organization/WebSite JSON-LD using verified Rack Relic facts. Preserve route-specific metadata; do not assign the homepage canonical to every SPA route.
2. Provide a crawlable public About page explaining the marketplace and its actual launch status. Use distinct static content rather than another copy of the homepage shell.
3. Reconcile seller/buyer fees against the approved 5% + $0.50 buyer fee before exposing detailed fee guides in the sitemap. Do not infer the fee base, refund treatment or processing charges.
4. After launch acceptance, publish accurate seller steps, supported categories, delivery/returns policies and trust information. Include Product/Offer markup only for real available listings.
5. Verify ownership in Google Search Console and Bing Webmaster Tools and submit this sitemap in those dashboards. A sitemap file is not a submission or proof of indexing.
6. Build consistent, verified brand profiles and earn genuine customer reviews and independent coverage. Do not fabricate endorsements or recommendations.
7. Record a baseline of fixed discovery prompts and referral traffic. Distinguish brand search visibility, unbranded mentions, citations and actual signups/sales. Results vary by engine, location and time.

## Verification before publishing

- XML parses and includes only canonical public URLs.
- robots.txt references the same canonical sitemap and does not block the homepage or public assets.
- Existing routing leaves the two new static files directly accessible.
- Confirm public HTTP status and content type after deployment. Until verified, report these changes as source only.
- Coordinate with existing prelaunch PRs; do not merge payment or backend work through this patch.

## References

- https://help.openai.com/en/articles/9237897-searching-the-web-with-chatgpt
- https://developers.google.com/search/docs/appearance/ai-features

Crawl access creates eligibility. Neither these files nor any agency can guarantee inclusion or recommendations in AI answers.
