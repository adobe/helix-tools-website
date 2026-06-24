  <div class="report-template-instructions">

  <h4>INSTRUCTIONS FOR AI REPORT GENERATION</h4>

    <p><b>CRITICAL DATA INTEGRITY RULES:</b></p>
  <ul>
    <li><b>Use ONLY real data from tool responses</b> - no estimates, extrapolations, or made-up metrics</li>
    <li><b>Linked numbers must match dashboard exactly</b> - if you link "15k errors", clicking MUST show exactly 15k in filtered dashboard</li>
    <li><b>NEVER aggregate and link to parent</b> - if you sum multiple error types (15k + 8k = 23k), DO NOT link that sum to parent checkpoint if total is 40k. Link each individually or don't link the aggregate</li>
    <li><b>Raw values must match</b> - <code>title</code> attribute must contain EXACT value from tool (e.g., <code>title="40123"</code> not <code>title="40000"</code>)</li>
    <li><b>Nested facet counts</b> - when linking with nested facets, use count FROM THAT FILTERED VIEW, not parent total. If <code>checkpoint=error</code> shows 40k but <code>error.source=network</code> shows 15k, link "15k network errors" NOT "40k"</li>
    <li><b>Use "count" field from tool</b> - always use the "count" or "value" field, never "weight" or derived values</li>
    <li><b>Multi-facet links</b> - only link counts if tool provides data for THAT EXACT filter combination. Don't link "8k checkout errors" unless tool shows count for <code>error + /checkout</code> together</li>
    <li><b>UNITS MATTER:</b> LCP/INP/TTFB in seconds/ms (NEVER "k"), CLS unitless decimal, only counts use "k"</li>
    <li>[X] WRONG: "2.3k LCP" (means 2,300 not 2.3s) | [OK] CORRECT: "2.3s LCP", "4.9k sessions"</li>
  </ul>

  <p><b>CRITICAL: AGGREGATED SUBSETS MUST NOT BE LINKED TO PARENT:</b></p>
  <ul>
    <li><b>Problem:</b> You calculate "top 5 error sources = 5.8m" but link to <code>checkpoint=error</code> which shows 7.6m total → MISMATCH!</li>
    <li><b>Rule:</b> If your count is a SUBSET (top N, specific pages, filtered group), DO NOT link to parent checkpoint that includes ALL items</li>
    <li><b>Solutions:</b>
      <ul>
        <li><b>Best:</b> Mention aggregate WITHOUT link, then list items individually with nested facet links</li>
        <li><b>Alternative:</b> Use the TOTAL count from tool and link that (7.6m), then mention subset in separate sentence</li>
      </ul>
    </li>
    <li><b>Examples - WRONG:</b>
      <ul>
        <li>"<code>&lt;span data-facet="checkpoint" data-facet-value="error"&gt;5.8m errors&lt;/span&gt;</code> across top 5 sources" (dashboard shows 7.6m) [WRONG]</li>
        <li>"<code>&lt;span data-facet="checkpoint" data-facet-value="cwv-lcp"&gt;12k slow LCP&lt;/span&gt;</code> on mobile pages" when total LCP count is 18k [WRONG]</li>
      </ul>
    </li>
    <li><b>Examples - CORRECT:</b>
      <ul>
        <li>"The site experiences <code>&lt;span data-facet="checkpoint" data-facet-value="error"&gt;7.6m total errors&lt;/span&gt;</code>, with 5.8m concentrated across the top 5 sources: <code>&lt;span data-nested-facet="error.source" data-nested-value="network"&gt;2m network errors&lt;/span&gt;</code>, ..." [CORRECT]</li>
        <li>"JavaScript errors affect 5.8m sessions across the top 5 sources (no link), with <code>&lt;span data-nested-facet="error.source" data-nested-value="serialization"&gt;2.1m from poor serialization&lt;/span&gt;</code> as the leading cause." [CORRECT]</li>
      </ul>
    </li>
  </ul>

  <p><b>EDGE DELIVERY SERVICES (EDS) SITE DETECTION:</b></p>
  <ul>
    <li><b>If tool responses include <code>checkpoint=viewblock</code>, this is an Edge Delivery Services site</b></li>
    <li><b>NEVER mention detection logic in the report.</b> Do not say "viewblock checkpoints detected", "based on viewblock data", or explain how you identified the site as EDS. This is internal logic — the report reader already knows their site platform</li>
    <li>EDS sites have built-in automatic optimizations - tailor recommendations accordingly</li>
    <li><b>DO NOT recommend for EDS sites:</b>
      <ul>
        <li>Converting images to WebP format (EDS does this automatically)</li>
        <li>Image optimization via format conversion (already handled)</li>
        <li>Manual lazy loading of images (EDS handles this)</li>
      </ul>
    </li>
    <li><b>For EDS sites with ALL Core Web Vitals passing (score-good):</b>
      <ul>
        <li>DO NOT invent problems or create unnecessary recommendations</li>
        <li>It's OKAY to say "Site is performing well" and provide minimal Priority Actions</li>
        <li>ONLY suggest actions that have REAL impact based on actual data issues (errors ≥1%, poor engagement, high bounce, conversion drops)</li>
        <li>Focus on business metrics, content effectiveness, user engagement - NOT fake performance tweaks</li>
        <li>Quality over quantity - 2-3 impactful actions better than 6 made-up ones</li>
      </ul>
    </li>
    <li><b>For EDS sites with CWV issues:</b> Still highlight those issues and provide relevant recommendations (excluding image format conversion)</li>
  </ul>

  <p><b>FACET LINKING SYNTAX:</b></p>
  <ul>
    <li><b>Link each key insight</b> - wrap data-backed findings in facet spans. DON'T link general statements or context</li>
    <li><b>Use ACTUAL facet values from tool</b>, not display text. If tool shows <code>{"value": "paid"}</code>, use <code>"paid"</code>, not <code>"All paid traffic"</code></li>
  </ul>

  <p><b>Facet Syntax Patterns:</b></p>
  <ul>
    <li><b>Simple:</b> <code>&lt;span data-facet="checkpoint" data-facet-value="click"&gt;...&lt;/span&gt;</code></li>
    <li><b>One nested (.source OR .target):</b> <code>&lt;span data-facet="checkpoint" data-facet-value="error" data-nested-facet="error.source" data-nested-value="network"&gt;15k network errors&lt;/span&gt;</code></li>
    <li><b>Two nested (.source AND .target):</b> <code>&lt;span data-facet="checkpoint" data-facet-value="error" data-nested-facet="error.source" data-nested-value="network" data-nested-facet-2="error.target" data-nested-value-2="TypeError"&gt;3.2k network TypeErrors&lt;/span&gt;</code></li>
  </ul>

  <p><b>TWO-LEVEL NESTED FACETS - ENABLE BOTH CHECKBOXES:</b></p>
  <ul>
    <li>When insight involves BOTH source AND target (e.g., "network TypeErrors", "paid mobile traffic"), use BOTH nested facets</li>
    <li>This ensures clicking the link checks BOTH boxes in dashboard sidebar, showing the exact filtered data</li>
    <li><b>Example scenarios requiring two nested facets:</b></li>
    <li>• Error with source+target: "3.2k network TypeErrors" → <code>data-nested-facet="error.source" data-nested-value="network" data-nested-facet-2="error.target" data-nested-value-2="TypeError"</code></li>
    <li>• Click with source+target: "890 button clicks on /checkout" → <code>data-nested-facet="click.target" data-nested-value="button" data-nested-facet-2="click.source" data-nested-value="/checkout"</code> (if applicable)</li>
    <li>• LCP with source+device: "4.1s image LCP on mobile" → <code>data-facet="checkpoint" data-facet-value="cwv-lcp" data-nested-facet="cwv-lcp.source" data-nested-value="img"</code> + <code>&lt;span data-facet="userAgent" data-facet-value="mobile"&gt;</code> (separate span for device)</li>
    <li><b>Count must come from tool data with BOTH filters applied</b> - don't guess combined counts</li>
  </ul>

  <p><b>NUMBER FORMATTING:</b></p>
  <p>Wrap ALL numbers: <code>&lt;number-format title="[exact raw from tool] [trend]" trend="[rising|falling|stable]" sample-size="[count]"&gt;&lt;span class="formatted-value"&gt;[display]&lt;/span&gt;&lt;/number-format&gt;</code></p>
  <ul>
    <li><b>Counts (use "k"):</b> <code>230m page views</code>, <code>1.2k errors</code>, <code>4.9k sessions</code></li>
    <li><b>LCP (seconds, NEVER "k"):</b> <code>2.3s LCP</code> NOT <code>2.3k LCP</code></li>
    <li><b>INP (milliseconds):</b> <code>180ms INP</code> NOT <code>0.18k INP</code></li>
    <li><b>CLS (unitless decimal):</b> <code>0.12 CLS</code> NOT <code>0.12k CLS</code></li>
    <li><b>Percentages:</b> <code>45% bounce rate</code></li>
    <li><b>title must be EXACT raw value:</b> If tool says <code>40123</code>, use <code>title="40123"</code> not <code>title="40000"</code></li>
  </ul>

  <p><b>COMBINING METRICS + FACET LINKS:</b></p>
  <p>Wrap metric mentions in facet spans. Checkpoint mappings: LCP=<code>cwv-lcp</code>, CLS=<code>cwv-cls</code>, INP=<code>cwv-inp</code>, TTFB=<code>cwv-ttfb</code>, Errors=<code>error</code>, 404s=<code>404</code>, Click=<code>click</code>, Acquisition=<code>acquisition</code></p>
  <pre>&lt;span data-facet="checkpoint" data-facet-value="cwv-lcp"&gt;LCP of &lt;number-format title="2340 and rising" trend="rising" sample-size="4500"&gt;&lt;span class="formatted-value"&gt;2.3s&lt;/span&gt;&lt;/number-format&gt;&lt;/span&gt;</pre>

  <p><b>CONTENT REQUIREMENTS:</b></p>
  <ul>
    <li><b>BE SPECIFIC:</b> "Mobile LCP 3.2s vs desktop 1.8s" not "performance varies"</li>
    <li><b>INCLUDE BREAKDOWNS:</b> Mobile vs desktop, top vs bottom pages when data exists</li>
    <li><b>NAME SPECIFICS:</b> List actual URLs, error messages, referrer domains from tool</li>
    <li><b>SHOW THRESHOLDS:</b> Compare to standards (LCP: 2.5s, CLS: 0.1, INP: 200ms)</li>
    <li><b>NO REPETITION:</b> Each insight appears ONCE in most relevant section</li>
    <li><b>Target: 1200-1600 words</b></li>
  </ul>

  <p><b>NARRATIVE STYLE:</b></p>
  <ul>
    <li><b>Write flowing paragraphs</b> - default to 2-3 narrative paragraphs with metrics woven in. Use bullets when they enhance clarity (3+ distinct items, Priority Actions)</li>
    <li><b>Hook with surprises</b> - open with most important finding, not "This report analyzes..."</li>
    <li><b>Connect causes to effects</b> - "The slow LCP (3.2s) likely explains 65% mobile bounce"</li>
    <li><b>End with implications</b> - "This means ~12k users/month leave before page loads"</li>
    <li><b>Max 1 bold + 1 italic per section</b> for emphasis only</li>
  </ul>

  <p><b>ANALYSIS GUIDELINES:</b></p>
  <ul>
    <li>Include date range context from DATA TIME PERIOD section</li>
    <li>"Rising"/"falling" = trends, not absolute performance - focus on actual values vs thresholds</li>
    <li><b>CWV status in tool responses:</b> <code>"status": "poor"</code> = CRITICAL (failing CWV, MUST highlight), <code>"status": "needs-improvement"</code> = needs improvement, <code>"status": "good"</code> = passing. <code>"significant": true</code> = statistically significant deviation (proven, not random noise — prioritize these)</li>
    <li><b>Business thresholds:</b> Engagement/conversion &lt;25% = CRITICAL, bounce &gt;60% = CRITICAL</li>
    <li>Analyze ALL facets - not just performance. Check facet title attributes for context</li>
    <li>UTM data captures parameter names only (privacy by design) - don't suggest capturing values</li>
  </ul>

  <p><b>HTML FORMAT:</b></p>
  <ul>
    <li><code>&lt;h4&gt;</code> for section headings, <code>&lt;p&gt;</code> for all text, <code>&lt;b&gt;</code> for subsection labels, bullet character (•) for lists</li>
    <li>No emojis or markdown syntax in report content</li>
  </ul>

  </div>

  <!-- ACTUAL REPORT STRUCTURE STARTS HERE -->

  <p><b>CONDITIONAL SECTIONS:</b></p>
  <ul>
    <li><b>JavaScript Errors:</b> Always include if errors ≥1% of total traffic (calculate: error count / page views × 100). Also include if errors are below 1% BUT concentrated on conversion-critical pages (checkout, cart, payment, contact, signup, login) or affecting a specific device/locale segment entirely — low volume does not mean low impact.</li>
    <li><b>All Other Sections:</b> Always include (Executive Summary, Performance Impact, User Engagement, Traffic & Acquisition, Content Effectiveness, Conversion Funnel, Geographic Insights, Market Opportunities, Business Impact, Priority Actions)</li>
  </ul>

  <h4>EXECUTIVE SUMMARY</h4>
  <p>Max 150 words. (1) Context: site type, time period, (2) Hook with most important finding + overall health, (3) Three key findings as bullets with facet links - wrap ENTIRE finding in facet span:</p>
  <pre>&lt;p&gt;• &lt;span data-facet="checkpoint" data-facet-value="cwv-lcp"&gt;LCP at 3.2s exceeds 2.5s threshold—mobile bounce 65% vs desktop 32%.&lt;/span&gt;&lt;/p&gt;</pre>

  <h4>JAVASCRIPT ERRORS THAT NEED ATTENTION</h4>
  <p><b>Include if errors ≥1% of traffic OR if errors concentrate on business-critical pages/segments.</b> Calculate overall rate: (error count / page views) × 100</p>

  <p><b>SECTION STRUCTURE — business impact first, then user impact:</b></p>
  <ol>
    <li><b>Open with top pages affected by errors.</b> Use the PER-PAGE ERROR BREAKDOWN from cross-reference data. Lead with the pages that have the most errors, especially conversion-critical ones (checkout, cart, payment, signup, upload) or high-traffic pages. For each page: name it (linked), state its error count, and list the specific error types occurring ON that page (linked with nested facets). Include CWV impact if the per-page data shows poor+significant metrics.</li>
    <li><b>Then cover the broader error patterns</b> in flowing narrative: total error rate, dominant error sources/targets globally. List each significant error type as a bullet — however many the data shows (do NOT pre-state a count like "two patterns" or "three sources" before the list). <b>Every bullet MUST be wrapped in a facet link</b> — error sources use <code>data-nested-facet="error.source"</code>, error targets use <code>data-nested-facet="error.target"</code>. No plain-text mentions of error sources or targets without a link.</li>
    <li><b>Close with user-facing consequence</b> — what real users experience because of these errors (broken forms, failed uploads, unresponsive pages). Connect each consequence to the specific page + error data that proves it. Every consequence statement must include a linked reference.</li>
  </ol>

  <p><b>DATA-BACKED FINDINGS ONLY:</b></p>
  <ul>
    <li>Every finding MUST trace to a specific tool response or cross-reference result</li>
    <li>DO NOT speculate: no "likely", "probably", "suggests", "may indicate", "potentially"</li>
    <li>DO NOT infer correlations between separate data points — only cite what appears in the SAME filtered view</li>
    <li>If the cross-reference shows errors ON a page, you can state that. If it doesn't, don't claim it</li>
    <li>DO NOT mention conversion pages (signup, checkout, contact) unless the cross-reference data explicitly shows errors on those URLs. Generic statements like "preventing users from reaching conversion pages" without a linked page URL are banned</li>
    <li>The UX consequence paragraph MUST also be linked — if you say "users experience broken navigation", link to the specific error type and page where it happens. Every consequence claim needs a data-facet span pointing to the proof</li>
  </ul>

  <p><b>COUNT-MATCH RULE:</b> If you state a number of items ("dominated by two patterns", "three key sources"), the items listed MUST match that number EXACTLY. Don't say "two" then list three or four. Count your bullets BEFORE writing the intro sentence.</p>

  <p><b>STYLE:</b> Natural flowing paragraphs with bullets where listing specifics. Every data point linked. Don't open with the dry error rate percentage — open with the pages where errors hit hardest. NEVER pre-state a count before a list (no "dominated by two patterns", "three key sources"). Just list the items directly.</p>

  <p><b>ERROR COUNT ACCURACY:</b></p>
  <ul>
    <li><b>Use TOTAL from tool</b> when linking to <code>checkpoint=error</code> — don't link your calculated subset</li>
    <li><b>If discussing "top N sources":</b> Mention aggregate WITHOUT link, then detail each source with nested facets</li>
  </ul>

  <p><b>TWO-LEVEL NESTED ERRORS:</b> If discussing errors with BOTH source AND target (e.g., "network TypeErrors"), use BOTH nested facets so both checkboxes enable.</p>

  <p><b>LINKING RULES:</b></p>
  <ul>
    <li><b>Page references:</b> <code>&lt;span data-facet="url" data-facet-value="/path"&gt;page (COUNT errors)&lt;/span&gt;</code></li>
    <li><b>Error sources:</b> <code>&lt;span data-facet="checkpoint" data-facet-value="error" data-nested-facet="error.source" data-nested-value="SOURCE"&gt;description&lt;/span&gt;</code></li>
    <li><b>Error targets:</b> <code>&lt;span data-facet="checkpoint" data-facet-value="error" data-nested-facet="error.target" data-nested-value="TARGET"&gt;description&lt;/span&gt;</code></li>
    <li><b>Error on a specific page (URL context):</b> Add <code>data-url-context="/path"</code> to error links when discussing errors that occur on a specific page. This enables BOTH the error checkbox AND the URL checkbox in the dashboard, showing the exact correlation. Example: <code>&lt;span data-facet="checkpoint" data-facet-value="error" data-nested-facet="error.source" data-nested-value="network" data-url-context="/track"&gt;network errors on /track&lt;/span&gt;</code></li>
    <li><b>Device segments:</b> <code>&lt;span data-facet="userAgent" data-facet-value="VALUE"&gt;description&lt;/span&gt;</code></li>
    <li><b>No unlinked data points.</b> Every page, error type, device, or count mentioned MUST be linked</li>
    <li><b>No unproven claims.</b> Only cite what the cross-reference data explicitly shows</li>
  </ul>
  <p><b>WHEN TO USE data-url-context:</b> Use it when citing errors from the PER-PAGE ERROR BREAKDOWN. The cross-reference proves these errors occur on that specific page, so the link should filter to BOTH error type + page URL for easy validation.</p>

  <h4>PERFORMANCE IMPACT</h4>
  <p>100-150 words. Lead with the WORST CWV metrics — items with <code>"status": "poor"</code> and especially <code>"significant": true</code>. These are proven failures, not noise.</p>
  <ul>
    <li><b>Prioritize:</b> poor+significant > poor > needs-improvement. Skip metrics that are passing unless they provide useful contrast (e.g., "desktop LCP passes at 1.8s but mobile fails at 3.4s")</li>
    <li><b>Quantify impact:</b> Compare to thresholds (LCP: 2.5s, CLS: 0.1, INP: 200ms). State what's failing and by how much</li>
    <li><b>Break down by segment:</b> Mobile vs desktop, top pages vs site-wide. Highlight where poor CWV concentrates</li>
    <li><b>Connect to consequences:</b> Poor LCP → SEO ranking penalty, user abandonment. Poor INP → broken interactions. Poor CLS → accidental clicks, frustration</li>
    <li><b>Skip if all green:</b> If ALL CWV are passing (status: good), state that in 1-2 sentences and move on — don't invent problems</li>
  </ul>

  <h4>USER ENGAGEMENT</h4>
  <p>100-150 words. Focus on signals that indicate problems or opportunities — not vanity metrics.</p>
  <ul>
    <li><b>Lead with:</b> Bounce rate (critical if >60%), engagement rate (critical if <25%), device split showing poor mobile engagement</li>
    <li><b>Highlight disparities:</b> If mobile bounce is 2x desktop, that's the story — not total page views</li>
    <li><b>Connect to CWV:</b> If a device segment has poor CWV (from tool data), connect it to its engagement metrics. "Mobile users experience 3.4s LCP and bounce at 68%" is provable if both data points come from the userAgent facet</li>
    <li><b>Skip unremarkable:</b> Don't report session counts unless they reveal something (e.g., dramatic drop, unexpected ratio)</li>
  </ul>

  <h4>TRAFFIC & ACQUISITION</h4>
  <p>100-150 words. Focus on what's working, what's not, and where opportunity exists.</p>
  <ul>
    <li><b>Lead with:</b> Dominant traffic sources and their conversion effectiveness. If paid traffic has poor CWV (status: poor, significant), that's wasted spend — highlight it</li>
    <li><b>Highlight imbalances:</b> Heavy reliance on one channel, high-volume sources with poor engagement, underperforming paid vs organic</li>
    <li><b>Use acquisition facet data:</b> Only cite sources that appear in tool responses with counts</li>
    <li><b>Skip generic:</b> Don't list all sources with counts — focus on the 2-3 that tell a story</li>
  </ul>

  <h4>CONTENT EFFECTIVENESS</h4>
  <p>100-150 words. Focus on pages that need attention based on data signals.</p>
  <ul>
    <li><b>Lead with:</b> Pages with poor CWV (status: poor from url facet), high bounce, or low engagement — these are underperforming despite traffic</li>
    <li><b>Highlight:</b> High-traffic pages with problems (poor performance, high errors, low conversion). Low-traffic pages that convert well (opportunity to drive more traffic)</li>
    <li><b>Use url facet data:</b> Cite specific page paths and their metrics from tool responses</li>
    <li><b>Skip:</b> Don't list top pages by traffic unless their metrics reveal issues. "Homepage gets most views" is not an insight</li>
  </ul>

  <h4>CONVERSION FUNNEL</h4>
  <p>100-150 words. Focus on where users drop off and why.</p>
  <ul>
    <li><b>Lead with:</b> The biggest drop-off point in the funnel (if convert/click checkpoint data exists). Quantify the gap — "X users click but only Y convert"</li>
    <li><b>Connect to problems:</b> If pages in the conversion path have poor CWV or errors (from cross-reference data), that's likely causing the drop-off</li>
    <li><b>Quantify opportunity:</b> "Fixing the 3.4s LCP on /checkout could recover Z% of the N users who bounce there"</li>
    <li><b>Skip if no data:</b> If no convert checkpoint or click funnel data exists, keep this section brief — don't speculate about journeys without data</li>
  </ul>

  <h4>GEOGRAPHIC INSIGHTS</h4>
  <p>100-150 words. Only include if geographic/locale data exists in tool responses.</p>
  <ul>
    <li><b>Lead with:</b> Regions with poor CWV (status: poor) or disproportionate error rates — users in those regions have a broken experience</li>
    <li><b>Highlight:</b> Performance gaps between regions (e.g., "users in region X experience 5.2s LCP vs 2.1s globally"). Regions where errors concentrate</li>
    <li><b>Skip if no signal:</b> If geographic data shows even distribution with no poor metrics, state "No significant regional variations" in 1 sentence</li>
  </ul>

  <h4>MARKET OPPORTUNITIES</h4>
  <p>100-150 words. Actionable growth opportunities backed by data.</p>
  <ul>
    <li><b>Lead with:</b> Quick wins where fixing a data-proven problem unlocks value — e.g., "fixing mobile LCP would improve experience for 65% of traffic"</li>
    <li><b>Base on data:</b> Every opportunity must reference a specific metric or finding from earlier sections. Not generic advice</li>
    <li><b>Quantify:</b> "N users/month affected", "X% of traffic on this segment", "Y conversion gap"</li>
    <li><b>Skip generic:</b> Don't suggest "SEO improvements" or "expand to new markets" without data showing the opportunity</li>
  </ul>

  <h4>BUSINESS IMPACT</h4>
  <p>100-150 words. Translate the technical findings into business cost.</p>
  <ul>
    <li><b>Lead with:</b> The highest-cost problem. Errors on conversion pages, poor CWV on high-traffic pages, broken device segments — whichever costs the business most</li>
    <li><b>Quantify in business terms:</b> "N users/month hit errors on conversion pages", "X% of mobile sessions bounce due to slow load", "Y broken experiences per day on the primary funnel"</li>
    <li><b>Reference earlier data:</b> This section synthesizes — it should cite the same data points (linked) from Performance, Errors, Engagement sections. Don't introduce new findings here</li>
    <li><b>Rank by severity:</b> Revenue impact > user experience > SEO > brand perception</li>
  </ul>

  <h4>PRIORITY ACTIONS</h4>
  <p><b>Edge Delivery Services SITE HANDLING:</b></p>
  <ul>
    <li><b>If this is an EDS site (viewblock checkpoint exists):</b>
      <ul>
        <li>DO NOT recommend: WebP conversion, image format optimization, manual lazy loading</li>
        <li><b>If ALL CWV are green (score-good):</b> Site is already well-optimized. Provide 2-3 high-impact actions ONLY IF real issues exist (errors ≥1%, poor engagement &lt;25%, bounce &gt;60%, conversion problems). If no real issues, say "Site performing well - focus on content/business metrics" with 1-2 content-focused suggestions.</li>
        <li><b>If ANY CWV failing:</b> Provide relevant technical actions (excluding image format work)</li>
      </ul>
    </li>
    <li><b>If NOT an EDS site:</b> Follow standard recommendations including image optimization</li>
  </ul>

  <p><b>Standard Priority Actions Structure:</b></p>
  <p>List 4-6 quick wins (HIGH IMPACT + EASY FIX) when real issues exist. 2-3 high-impact actions when site is performing well. NO long-term projects or timelines.</p>
  <p><b>EXACT category names (do NOT rename or invent others):</b></p>
  <p><b>Content Actions (2-3 when needed):</b> Broken links, alt text, metadata, content improvements (NOT WebP for EDS sites)</p>
  <p><b>Code Actions (2-3 when needed):</b> Caching, error fixes, performance tweaks specific to actual problems (NOT image format for EDS sites)</p>
  <p><b>DO NOT use other category names</b> like "Infrastructure Tasks", "Technical Tasks", "Monitoring Tasks", etc. ALL actions must go under either "Content Actions" or "Code Actions".</p>
  <p><b>Prioritize:</b> (1) Real issues with data backing, (2) Quick wins, (3) High traffic impact, (4) CWV issues (if failing), (5) Revenue-impacting</p>
  <p><b>Format:</b> Wrap action in facet link, leave "Expected Impact:" unlinked</p>
  <pre>&lt;p&gt;• &lt;span data-facet="checkpoint" data-facet-value="cwv-lcp"&gt;Implement responsive images with srcset.&lt;/span&gt; Expected Impact: Reduce LCP from 3.3s toward 2.5s.&lt;/p&gt;</pre>

  <p><b>Example Priority Actions for EDS site with green CWV:</b></p>
  <pre>&lt;p&gt;&lt;b&gt;Content Actions&lt;/b&gt;&lt;/p&gt;
  &lt;p&gt;• &lt;span data-facet="url" data-facet-value="/blog"&gt;Improve internal linking from blog posts.&lt;/span&gt; Expected Impact: Increase engagement and reduce 52% bounce rate.&lt;/p&gt;
  &lt;p&gt;• &lt;span data-facet="checkpoint" data-facet-value="click" data-nested-facet="click.target" data-nested-value="nav"&gt;Simplify navigation structure.&lt;/span&gt; Expected Impact: Improve user journey and increase conversions.&lt;/p&gt;</pre>

  <div class="report-requirements">

  <h4>PRE-SUBMISSION VERIFICATION WORKFLOW</h4>
  <p><b>Before generating, verify EACH metric using this process:</b></p>
  <ol>
    <li><b>Check for EDS site:</b> Does tool response include <code>checkpoint=viewblock</code>?</li>
    <li><b>Check CWV status:</b> Are ALL CWV metrics score-good? If yes + EDS site, limit recommendations to real issues only</li>
    <li>Find metric in tool response - locate exact JSON with count/value</li>
    <li>Copy exact count - use raw number from "count" field</li>
    <li>Determine facet link - what filter state produces this count?</li>
    <li>Check nested facets - if using .source/.target, is count from that nested level?</li>
    <li>For two-level nested - do you have count with BOTH filters applied? Use both nested-facet attributes</li>
    <li>Write number-format - title="[exact raw]", formatted-value="[rounded]"</li>
    <li>Mental click test - "If I click this link, will dashboard show this count?"</li>
  </ol>

  <p><b>FINAL CHECKLIST - Every linked metric must pass ALL checks:</b></p>
  <ul>
    <li>□ No aggregated SUBSETS linked to parent checkpoints (5.8m top-5 cannot link to error=7.6m total)</li>
    <li>□ When mentioning "top N" or filtered subsets, either don't link OR link each item individually</li>
    <li>□ EDS site detected (viewblock exists)? If yes + all CWV green, avoid unnecessary recommendations</li>
    <li>□ No WebP/image format recommendations for EDS sites</li>
    <li>□ Priority Actions based on REAL issues with data backing, not invented problems</li>
    <li>□ Raw value in <code>title</code> matches tool exactly (40123, not 40000 or 40k)</li>
    <li>□ Linked count matches FILTERED dashboard view (not parent total)</li>
    <li>□ Nested facets: count from nested level, not parent</li>
    <li>□ Two-level nested: count from tool with BOTH filters applied, both nested-facet attrs present</li>
    <li>□ Multi-facet links: only if tool has combined filter count</li>
    <li>□ Units: LCP/INP/TTFB/CLS never use "k", only counts use "k"</li>
    <li>□ No aggregated sums linked unless tool provides exact total</li>
    <li>□ Every facet value exists as selectable checkbox in dashboard</li>
    <li>□ No made-up/estimated data - only real tool values</li>
  </ul>

  <p><b>GOLD STANDARD TEST:</b></p>
  <p><i>"User clicks link → dashboard filters apply → dashboard total EXACTLY matches report number (accounting for same rounding: 40123 → 40k in both places). Hover shows same raw value in both."</i></p>

  <h4>LENGTH & FORMAT SUMMARY</h4>
  <ul>
    <li><b>Total:</b> 1200-1600 words | <b>Executive Summary:</b> Max 150 words | <b>Each section:</b> 100-150 words | <b>Priority Actions:</b> 2-6 items based on real issues</li>
    <li>No timelines in Priority Actions, no emojis in content, flowing narrative with selective bullets</li>
    <li><b>Quality over quantity:</b> Better to have 2 impactful actions than 6 unnecessary ones</li>
  </ul>

</div>