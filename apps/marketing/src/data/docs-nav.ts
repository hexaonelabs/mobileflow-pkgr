export interface DocsPage {
  /** Path segment under /docs. Empty string is the docs hub itself (/docs). */
  slug: string;
  title: string;
  summary: string;
}

export interface DocsSection {
  title: string;
  pages: DocsPage[];
}

export const DOCS_NAV: DocsSection[] = [
  {
    title: 'Getting started',
    pages: [
      {
        slug: '',
        title: 'Introduction',
        summary: 'What pkgr.app is and how the pieces fit together.',
      },
      {
        slug: 'quickstart',
        title: 'Quickstart',
        summary: 'Connect a repo and ship your first signed build.',
      },
      {
        slug: 'concepts',
        title: 'Core concepts',
        summary: 'Projects, builds, environments, and run tokens.',
      },
    ],
  },
  {
    title: 'Repository & builds',
    pages: [
      {
        slug: 'github-app',
        title: 'Connecting your repository',
        summary: 'Install the GitHub App and pick a branch.',
      },
      {
        slug: 'builds',
        title: 'Triggering & managing builds',
        summary: 'Push-triggered runs, manual builds, and history.',
      },
      {
        slug: 'ota-installs',
        title: 'Installing staging builds',
        summary: 'Ad Hoc install links and artifact retention.',
      },
    ],
  },
  {
    title: 'Signing & secrets',
    pages: [
      {
        slug: 'secret-vault',
        title: 'Secret Vault',
        summary: 'How certificates and keystores are stored and used.',
      },
      {
        slug: 'ios-signing',
        title: 'iOS signing',
        summary: 'Certificates and provisioning profiles.',
      },
      {
        slug: 'android-signing',
        title: 'Android signing',
        summary: 'Uploading and using your keystore.',
      },
    ],
  },
  {
    title: 'Insights & alerts',
    pages: [
      {
        slug: 'analytics',
        title: 'Analytics',
        summary: 'Build success rate, duration, and trends.',
      },
      {
        slug: 'notifications',
        title: 'Notifications',
        summary: 'Slack and email alerts on build status.',
      },
    ],
  },
  {
    title: 'Account',
    pages: [
      {
        slug: 'plans',
        title: 'Plans & limits',
        summary: 'What each plan unlocks, today and later.',
      },
      {
        slug: 'faq',
        title: 'FAQ & troubleshooting',
        summary: 'Common signing errors and where to get help.',
      },
    ],
  },
];

export const DOCS_PAGES: DocsPage[] = DOCS_NAV.flatMap((section) => section.pages);

export function docsHref(slug: string): string {
  return slug ? `/docs/${slug}` : '/docs';
}
