
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

type AIResponseProps = {
  content: string;
};

export default function AIResponse({
  content,
}: AIResponseProps) {
  return (
    <div className="space-y-4 break-words text-sm leading-7 text-slate-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        components={{
          h1: ({ children }) => (
            <h1 className="mb-5 mt-6 text-2xl font-bold text-slate-900">
              {children}
            </h1>
          ),

          h2: ({ children }) => (
            <h2 className="mb-3 mt-6 border-b border-slate-200 pb-2 text-xl font-semibold text-slate-900">
              {children}
            </h2>
          ),

          h3: ({ children }) => (
            <h3 className="mb-2 mt-5 text-lg font-semibold text-slate-800">
              {children}
            </h3>
          ),

          h4: ({ children }) => (
            <h4 className="mt-4 font-semibold text-slate-800">
              {children}
            </h4>
          ),

          p: ({ children }) => (
            <p className="my-3 leading-7">
              {children}
            </p>
          ),

          strong: ({ children }) => (
            <strong className="font-semibold text-slate-900">
              {children}
            </strong>
          ),

          ul: ({ children }) => (
            <ul className="my-3 list-disc space-y-2 pl-6">
              {children}
            </ul>
          ),

          ol: ({ children }) => (
            <ol className="my-3 list-decimal space-y-2 pl-6">
              {children}
            </ol>
          ),

          li: ({ children }) => (
            <li className="pl-1">{children}</li>
          ),

          hr: () => (
            <hr className="my-6 border-slate-200" />
          ),

          blockquote: ({ children }) => (
            <blockquote className="my-4 rounded-r-lg border-l-4 border-indigo-500 bg-indigo-50 p-4">
              {children}
            </blockquote>
          ),

          table: ({ children }) => (
            <div className="my-5 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full border-collapse text-left text-sm">
                {children}
              </table>
            </div>
          ),

          th: ({ children }) => (
            <th className="border border-slate-200 bg-slate-100 px-4 py-3 font-semibold">
              {children}
            </th>
          ),

          td: ({ children }) => (
            <td className="border border-slate-200 px-4 py-3">
              {children}
            </td>
          ),

          pre: ({ children }) => (
            <pre className="my-4 overflow-x-auto rounded-xl bg-slate-900 p-4 text-sm text-slate-100">
              {children}
            </pre>
          ),

          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 underline"
            >
              {children}
            </a>
          ),

          img: () => (
            <span className="text-xs text-slate-500">
              [External image omitted]
            </span>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
