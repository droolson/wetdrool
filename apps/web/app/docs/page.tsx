import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { DOCS_ARTICLES, DOCS_GROUPS, articlesForGroup } from '@/lib/docs-catalog';

export const metadata: Metadata = {
  title: 'Docs',
  description:
    'WetDrool product documentation — hub, shorts, live, creators, economy, mesh, deploy. Obsidian vault mirrored from the monorepo.',
};

export default function DocsPortalPage() {
  return (
    <div className="product-page page-shell docs-portal">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Obsidian vault · monorepo</StatusBadge>}
        eyebrow="wetdrool.com/docs"
        title="Product docs, not a brochure."
      >
        <p>
          Operator and builder notes for the WetDrool web app (RedGIFs-class shorts, tube hub, live,
          creators, Reddit-like points, X-like social). Source of truth lives in the repo under{' '}
          <code>docs/</code> and <code>docs/obsidian/</code>.
        </p>
        <p className="field-help">
          Pre-release honesty: synthetic media fixtures, <code>$DROOL</code> mint-pending, mesh not
          production. Jump into the app:{' '}
          <Link href="/hub">Hub</Link> · <Link href="/feeds">Shorts</Link> ·{' '}
          <Link href="/live">Live</Link>.
        </p>
      </AppPageHeader>

      <nav className="docs-portal__toc" aria-label="Doc groups">
        <ul>
          {DOCS_GROUPS.map((g) => (
            <li key={g.id}>
              <a href={`#group-${g.id}`}>{g.title}</a>
            </li>
          ))}
        </ul>
      </nav>

      {DOCS_GROUPS.map((group) => {
        const articles = articlesForGroup(group.id);
        return (
          <section
            key={group.id}
            id={`group-${group.id}`}
            className="docs-portal__group"
            aria-labelledby={`heading-${group.id}`}
          >
            <h2 id={`heading-${group.id}`}>{group.title}</h2>
            <p>{group.blurb}</p>
            <ul className="docs-portal__list">
              {articles.map((article) => (
                <li key={article.id}>
                  <article className="docs-portal__card">
                    <h3>{article.title}</h3>
                    <p>{article.summary}</p>
                    <p className="docs-portal__path">
                      <code>docs/{article.repoPath}</code>
                    </p>
                    <ul className="docs-portal__tags">
                      {article.tags.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="docs-portal__meta" aria-label="Catalog size">
        <p>
          {DOCS_ARTICLES.length} catalog entries · open the markdown files in Obsidian by pointing a
          vault at the repo <code>docs/</code> folder (or <code>docs/obsidian/</code> only).
        </p>
      </section>
    </div>
  );
}
