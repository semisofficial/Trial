import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { lastUpdated } from "../content/legalContent.js";

function setMeta(name, content) {
  const element = document.head.querySelector(`meta[name="${name}"]`);
  if (element) element.setAttribute("content", content);
}

export default function LegalPage({ title, description, canonicalPath, sections }) {
  useEffect(() => {
    document.title = `${title} | Semi's Kitchen`;
    setMeta("description", description);
    document.head.querySelector('link[rel="canonical"]')?.setAttribute("href", `https://semiskitchen.in${canonicalPath}`);
  }, [title, description, canonicalPath]);

  return (
    <main className="min-h-screen bg-[#F6EDD7] px-5 py-10 text-[#3F3B24] sm:py-16">
      <article className="mx-auto max-w-3xl rounded-3xl border border-[#E8D7B5] bg-[#FFF8E8] p-6 shadow-sm sm:p-10">
        <a href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-[#6F6F32] hover:underline">
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to menu
        </a>
        <h1 className="text-3xl font-semibold sm:text-4xl" style={{ fontFamily: "var(--font-serif)" }}>{title}</h1>
        <p className="mt-2 text-sm text-[#6F6657]">Last updated: {lastUpdated}</p>
        <div className="mt-10 space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--font-serif)" }}>{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-[#5C554A] sm:text-base">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
