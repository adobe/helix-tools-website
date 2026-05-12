# Author actions to complete the UX refresh

These are CMS / DA edits that complement the code changes in this PR.

1. **Nav fragment cleanup**: in DA, edit the `/nav` fragment and remove the top-level `🏠 Home` link. The catalog "All" tab supersedes it.
2. **Optional**: review the categories in `/nav`. The slugs derived from the labels are `setup-configure`, `publish-manage`, `dev-diagnostics`. If you change a category label, update the `<meta name="category">` tag in each affected tool's `index.html` to match the new slug.
