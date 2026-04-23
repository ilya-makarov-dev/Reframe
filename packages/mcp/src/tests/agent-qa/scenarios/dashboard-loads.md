# Dashboard renders with project cards

Walks the first-time-user path: navigate to /platform, verify that
the dashboard panel is composed through INode (not legacy hand-HTML),
and that key chrome elements carry the expected semantic paths.

- navigate /platform
- assert-role app-shell/root
- assert-role app-shell/header
- assert-role app-shell/wordmark
- assert-role app-shell/theme-toggle
- assert-role app-shell/sidebar
- assert-role app-shell/main
- assert-role dashboard/root
- assert-role dashboard/project-card
