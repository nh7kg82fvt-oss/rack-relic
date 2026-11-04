# Rack Relic search discovery

## Scope

Rack Relic is a fashion resale marketplace preview at https://www.rackrelic.com/. Its public homepage currently describes fashion, sneakers and streetwear, favorites and listing preparation. Do not imply checkout, payments or buyer protection are live until launch acceptance verifies them. Keep this work separate from Clear Choice Payments.

## Crawl foundation

- Serve robots.txt as text/plain and sitemap.xml as application/xml (text/xml is also acceptable), both with HTTP 200 at the canonical www host.
- The sitemap includes the public homepage, static marketplace guide, seller guide, safety, support, community guidelines and privacy documents. Each policy document declares its clean canonical route to consolidate its direct /policies/ URL. Expand it only with verified, substantive public pages using their canonical URLs. Never add demo inventory, private accounts, messages, reports or drafts.
- robots.txt allows general search crawlers, including OAI-SearchBot, under the wildcard rule. It excludes demo/listing routes pending launch and personal/API workflows. Robots directives are not access controls; preserve authorization and privacy enforcement.
- Verify hosting/firewall access separately for Googlebot, Bingbot and OAI-SearchBot. A robots file alone cannot prove crawler access.
- No training-crawler preference is changed by this patch; it documents public discovery only.

## Next implementation

1. Homepage Open Graph and Organization/WebSite JSON-LD are included. The static marketplace guide has its own canonical and AboutPage data. Preserve route-specific metadata; do not assign the homepage canonical to every SPA route.
2. The crawlable /marketplace-guide.html explains the marketplace and actual preview status with distinct static content. Update availability only after launch acceptance.
3. The existing seller guide confirms the planned buyer fee is 5% of the item subtotal + $0.50 per order, with shipping and tax separate. It is now in the sitemap with preview status preserved. No seller processing cost or refund rule was added or inferred.
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

## Public help-page metadata

Public policy documents use page-specific descriptions, canonical clean URLs, Open Graph metadata and WebPage/BreadcrumbList JSON-LD. Their direct /policies/*.html versions point to the same canonical clean routes. The homepage and marketplace guide identify the same Rack Relic social profiles already linked from the homepage. Use supportrackrelic@gmail.com for Rack-only Google dashboard sign-in; public support remains support@rackrelic.com. Google/Bing ownership verification and sitemap submissions still require their own dashboard confirmation.
