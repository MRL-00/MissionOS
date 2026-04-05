import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpenIcon, ChevronRightIcon, FileTextIcon, FolderIcon } from "lucide-react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { cn } from "@/lib/utils";

interface DocGroup {
  name: string;
  docs: Array<{ path: string; title: string }>;
}

export function DocsPage({ mission }: { mission: MissionControlState }) {
  const grouped = useMemo(() => {
    const groups = new Map<string, Array<{ path: string; title: string }>>();
    for (const doc of mission.docs) {
      const parts = doc.path.split("/");
      const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder)!.push(doc);
    }
    const result: DocGroup[] = [];
    // Root docs first
    const root = groups.get("");
    if (root) result.push({ name: "", docs: root });
    groups.delete("");
    // Then subdirectories
    for (const [name, docs] of groups) {
      result.push({ name, docs });
    }
    return result;
  }, [mission.docs]);

  return (
    <div className="flex h-full">
      <div className="w-[260px] shrink-0 overflow-y-auto border-r border-white/[0.06] bg-[#131314] p-4">
        <div className="mb-4 flex items-center gap-2">
          <BookOpenIcon className="size-4 text-[#5e4ae3]" />
          <span className="text-[12px] font-semibold uppercase tracking-wider text-[#918f90]">Documentation</span>
        </div>
        <div className="space-y-4">
          {grouped.map((group) => (
            <div key={group.name || "__root"}>
              {group.name ? (
                <div className="mb-1.5 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-[#585658]">
                  <FolderIcon className="size-3" />
                  {group.name}
                </div>
              ) : null}
              <div className="space-y-0.5">
                {group.docs.map((doc) => {
                  const isActive = mission.docPath === doc.path;
                  return (
                    <button
                      key={doc.path}
                      onClick={() => void mission.openDoc(doc.path)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] transition-colors",
                        isActive
                          ? "bg-[#39147e]/[0.12] text-white"
                          : "text-[#918f90] hover:bg-white/[0.04] hover:text-[#c8c4d7]",
                      )}
                    >
                      {isActive ? <ChevronRightIcon className="size-3 shrink-0 text-[#5e4ae3]" /> : <FileTextIcon className="size-3 shrink-0 text-[#585658]" />}
                      <span className="truncate">{doc.title || doc.path}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        {mission.docContent ? (
          <article className="prose prose-invert mx-auto max-w-3xl prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-2xl prose-h1:border-b prose-h1:border-white/[0.06] prose-h1:pb-3 prose-h2:text-xl prose-h3:text-base prose-p:text-[#c8c4d7] prose-p:leading-relaxed prose-a:text-[#5e4ae3] prose-a:no-underline hover:prose-a:text-[#c6bfff] prose-strong:text-white prose-code:rounded prose-code:bg-white/[0.06] prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[#c6bfff] prose-code:before:content-none prose-code:after:content-none prose-pre:rounded-xl prose-pre:border prose-pre:border-white/[0.06] prose-pre:bg-[#0f0f10] prose-li:text-[#c8c4d7] prose-li:marker:text-[#585658] prose-table:text-[13px] prose-th:text-[#918f90] prose-th:border-white/[0.08] prose-td:border-white/[0.06] prose-hr:border-white/[0.06] prose-blockquote:border-[#5e4ae3]/40 prose-blockquote:text-[#918f90]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{mission.docContent}</ReactMarkdown>
          </article>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <BookOpenIcon className="mb-4 size-12 text-[#585658]" />
            <h3 className="mb-1 text-[15px] font-semibold text-white">Select a document</h3>
            <p className="text-[13px] text-[#918f90]">Choose a document from the sidebar to view it.</p>
          </div>
        )}
      </div>
    </div>
  );
}
